import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./commandRegistry.js";
import { createCommandProvider } from "./providers/commandProvider.js";
import { type Provider, type PaletteItem, type PaletteResult, type CommandResult, ExitCode, fail } from "./types.js";
import type { Module, ModuleApi } from "./modules/types.js";
import { startTriggerServer } from "./httpTrigger.js";
import { isSetupDone, setKarabinerPaletteOpen } from "./setup.js";
import { registerBuiltins } from "./core/builtins.js";
import { reportBridge } from "./core/bridgeStatus.js";
import { getBridge } from "./ableton/bridge.js";
import { presentResult } from "./core/present.js";
import { runLine } from "./core/run.js";
import { objectRowLine } from "./core/objectRow.js";
import { pickNodes } from "./core/pick.js";
import { createDialogQueue } from "./core/dialogQueue.js";
import { createDefaultUi, type PickPreview, type Ui } from "./core/ui.js";
import { buildObjectTree, flattenObjectTree, type ObjectNode } from "./ableton/objectTree.js";
import { trackFor } from "./ableton/trackLookup.js";
import { MODULES } from "./modules/index.js";

const TRIGGER_PORT = 27184;

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  // What this host provides, as types only (no values): evidence for "works in
  // Node but not here" bugs. Keep it; the answer belongs in docs/sdk-tree.md.
  const g = globalThis as Record<string, unknown>;
  const globals = ["URL", "URLSearchParams", "fetch", "structuredClone", "AbortController", "TextEncoder", "crypto"];
  console.log(`cmdAbl: host globals: ${globals.map((n) => `${n}=${typeof g[n]}`).join(", ")}`);
  const registry = new CommandRegistry();
  // Every dialog goes through this — the platform never opens an HTML page itself.
  // One queue: a dialog never opens while another is open (see core/dialogQueue.ts).
  const dialogs = createDialogQueue();
  const ui: Ui = createDefaultUi(context, dialogs);
  const providers: { provider: Provider; priority: number }[] = [];
  // The items of the palette that is open (or was opened last): a picked object row is found here.
  let paletteItems: PaletteItem[] = [];
  const commandRunListeners: Array<(invocation: string) => void> = [];
  const pickListeners: Array<(candidates: ObjectNode[], chosen: ObjectNode[] | null) => void> = [];

  const liveNodes = () => flattenObjectTree(buildObjectTree(context));

  /** The one pick list — used by the platform for ambiguous addresses and by modules. */
  async function pick(
    title: string,
    candidates: ObjectNode[],
    multi = false,
    extra: { nodes?: ObjectNode[]; preview?: PickPreview; details?: string[] } = {},
  ): Promise<ObjectNode[] | null> {
    // A module's own pick has no Live Set at hand; unique labels need it.
    const nodes = extra.nodes ?? liveNodes();
    const chosen = await pickNodes(ui, { title, candidates, multi, nodes, preview: extra.preview, details: extra.details });
    for (const listener of pickListeners) listener(candidates, chosen);
    return chosen;
  }
  let isOpen = false;

  function showFeedback(message: string): void {
    ui.notify({ text: message, code: ExitCode.OK });
  }

  // ── core: the only commands baked in (see src/core/builtins.ts) ───────────
  registerBuiltins(registry, { bridge: () => getBridge() });

  // ── default modules ──────────────────────────────────────────────────────
  const moduleApi: ModuleApi = {
    get bridge() {
      return getBridge();
    },
    liveSet: { nodes: liveNodes },
    tracks: {
      transaction: (fn) => context.withinTransaction(fn),
      // Only a track node has a track; a device or chain would give its CONTAINING track.
      track: (node) => (node.kind === "track" ? trackFor(context, node) : null),
    },
    log: (line) => console.log(line),
    dialog: (html, width, height, name = "module page") => ui.page(name, html, width, height),
    commands: { add: (command) => void registry.add(command) },
    pick,
    onPick: (listener) => pickListeners.push(listener),
    registerProvider: (provider, priority = 0) => providers.push({ provider, priority }),
    onCommandRun: (listener) => commandRunListeners.push(listener),
    showFeedback,
  };
  // The command list itself is a provider (priority 0); modules add theirs.
  moduleApi.registerProvider(createCommandProvider(registry));
  for (const mod of MODULES) mod.activate(moduleApi);

  // ── HTTP trigger server ──────────────────────────────────────────────────
  // Karabiner (or any external tool) can POST/GET http://127.0.0.1:27184/open
  // to open the command palette without a context menu; GET /state reports
  // open|closed; POST /reset and GET /bridge are temporary
  // diagnostics (a hung dialog; a timed hello while a dialog is open).
  startTriggerServer(TRIGGER_PORT, () => {
    context.commands.executeCommand("cmdabl.open");
  }, () => isOpen || dialogs.describe() !== null, () => {
    const was = dialogs.reset();
    if (was) return `dialog queue reset (was: ${was.name})`;
    return isOpen ? "no dialog open; a command is still running" : "no dialog was open";
  }, async () => (await reportBridge(getBridge())).line);

  // The Karabiner rule only fires while `cmdabl_open` is 0. If a previous host
  // was stopped with the palette open, the flag would stay at 1 and ":" would
  // silently do nothing — so start from a known state.
  setKarabinerPaletteOpen(false);

  // ── startup hint ─────────────────────────────────────────────────────────
  if (!isSetupDone()) {
    console.log("cmdAbl: keyboard trigger not configured. Open the palette and run: cmdabl setup");
  }

  // ── open command mode ────────────────────────────────────────────────────
  // Act on what the prompt surface returned.
  async function dispatch(result: PaletteResult): Promise<void> {
    let line: string;
    if (result.type === "command") {
      // The raw line keeps quotes intact.
      line = result.line ?? result.id;
    } else {
      // A Live-object row is the command `goto <unique path>`, run like a typed line.
      const row = paletteItems.find((item) => item.id === result.id && item.type === result.type);
      const mapped = objectRowLine({ id: result.id, kind: result.type, path: row?.path }, liveNodes());
      if (!mapped) {
        present(fail(ExitCode.NOT_FOUND, `that ${result.type} is no longer available`));
        return;
      }
      line = mapped;
    }
    const outcome = await runLine(line, {
      registry,
      liveNodes,
      bridge: () => getBridge(),
      pick: ({ title, candidates, multi, nodes, preview, details }) =>
        pick(title, candidates, multi, { nodes, preview, details }),
    });
    if (outcome.cancelled) return;
    present(outcome.result);
    // History gets successful invocations that carry arguments, in their
    // resolved form ("mute /Vermona MIDI"), so a re-run is never ambiguous.
    const invocation = outcome.line ?? line;
    if (outcome.result.code === ExitCode.OK && invocation.includes(" ")) {
      for (const listener of commandRunListeners) listener(invocation);
    }
  }

  /** The single place results become user-visible (see src/core/present.ts). */
  function present(outcome: CommandResult): void {
    presentResult(outcome, (text) => ui.notify({ text, code: outcome.code }));
  }

  async function openPalette(): Promise<void> {
    const shown = dialogs.describe();
    if (isOpen || shown) {
      // "isOpen but nothing shown" means a command is still running — the case to diagnose.
      console.log(`cmdAbl: trigger ignored: ${shown ?? "a command is still running (no dialog open)"}`);
      return;
    }
    isOpen = true;
    setKarabinerPaletteOpen(true);
    try {
      // Snapshot every provider's items, then let the webview search them.
      // Stable sort by priority (lower first); ties keep registration order.
      const ordered = [...providers].sort((a, b) => a.priority - b.priority);
      const items = (await Promise.all(ordered.map((p) => p.provider.getItems()))).flat();
      paletteItems = items;
      const result = await ui.prompt({ items });
      if (result) await dispatch(result);
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
    } finally {
      isOpen = false;
      // A message may still be on screen: the flag is reset when the last dialog closes.
      if (dialogs.describe() === null) setKarabinerPaletteOpen(false);
    }
  }
  dialogs.onIdle(() => {
    if (!isOpen) setKarabinerPaletteOpen(false);
  });

  context.commands.registerCommand("cmdabl.open", () => {
    void openPalette();
  });

  const scopes = ["AudioClip", "MidiClip", "AudioTrack", "MidiTrack", "ClipSlot", "Scene"] as const;
  for (const scope of scopes) {
    void context.ui.registerContextMenuAction(scope, ": cmdAbl", "cmdabl.open");
  }
}
