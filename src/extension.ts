import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./commandRegistry.js";
import { createCommandProvider } from "./providers/commandProvider.js";
import { type Provider, type PaletteResult, type CommandResult, ExitCode, fail } from "./types.js";
import type { Module, ModuleApi, ResultHandler } from "./modules/types.js";
import { startTriggerServer } from "./httpTrigger.js";
import { isSetupDone, setKarabinerPaletteOpen } from "./setup.js";
import { registerBuiltins } from "./core/builtins.js";
import { presentResult } from "./core/present.js";
import { runLine } from "./core/run.js";
import { pickNodes } from "./core/pick.js";
import { createDialogQueue } from "./core/dialogQueue.js";
import { createDefaultUi, type PickPreview, type Ui } from "./core/ui.js";
import { buildObjectTree, flattenObjectTree, type ObjectNode } from "./ableton/objectTree.js";
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
  const resultHandlers = new Map<string, ResultHandler>();
  const commandRunListeners: Array<(invocation: string) => void> = [];
  const pickListeners: Array<(candidates: ObjectNode[], chosen: ObjectNode[] | null) => void> = [];

  const liveNodes = () => flattenObjectTree(buildObjectTree(context));

  /** The one pick list — used by the platform for ambiguous addresses and by modules. */
  async function pick(
    title: string,
    candidates: ObjectNode[],
    multi = false,
    extra: { nodes?: ObjectNode[]; preview?: PickPreview } = {},
  ): Promise<ObjectNode[] | null> {
    // A module's own pick has no Live Set at hand; unique labels need it.
    const nodes = extra.nodes ?? liveNodes();
    const chosen = await pickNodes(ui, { title, candidates, multi, nodes, preview: extra.preview });
    for (const listener of pickListeners) listener(candidates, chosen);
    return chosen;
  }
  let isOpen = false;

  function showFeedback(message: string): void {
    ui.notify({ text: message, code: ExitCode.OK });
  }

  // ── core: the only commands baked in (see src/core/builtins.ts) ───────────
  registerBuiltins(registry);

  // ── default modules ──────────────────────────────────────────────────────
  const moduleApi: ModuleApi = {
    context,
    registry,
    commands: { add: (command) => void registry.add(command) },
    pick,
    onPick: (listener) => pickListeners.push(listener),
    registerProvider: (provider, priority = 0) => providers.push({ provider, priority }),
    registerResultHandler: (action, handler) => resultHandlers.set(action, handler),
    onCommandRun: (listener) => commandRunListeners.push(listener),
    showFeedback,
  };
  // The command list itself is a provider (priority 0); modules add theirs.
  moduleApi.registerProvider(createCommandProvider(registry));
  for (const mod of MODULES) mod.activate(moduleApi);

  // ── HTTP trigger server ──────────────────────────────────────────────────
  // Karabiner (or any external tool) can POST/GET http://127.0.0.1:27184/open
  // to open the command palette without a context menu; GET /state reports
  // open|closed; POST /reset is a temporary diagnostic for a hung dialog.
  startTriggerServer(TRIGGER_PORT, () => {
    context.commands.executeCommand("cmdabl.open");
  }, () => isOpen || dialogs.describe() !== null, () => {
    const was = dialogs.reset();
    if (was) return `dialog queue reset (was: ${was.name})`;
    return isOpen ? "no dialog open; a command is still running" : "no dialog was open";
  });

  // The Karabiner rule only fires while `cmdabl_open` is 0. If a previous host
  // was stopped with the palette open, the flag would stay at 1 and ":" would
  // silently do nothing — so start from a known state.
  setKarabinerPaletteOpen(false);

  // ── startup hint ─────────────────────────────────────────────────────────
  if (!isSetupDone()) {
    console.log("cmdAbl: keyboard trigger not configured. Open the palette and run: cmdabl --setup");
  }

  // ── open command mode ────────────────────────────────────────────────────
  // Act on what the prompt surface returned.
  async function dispatch(result: PaletteResult): Promise<void> {
    if (result.type === "command") {
      // Older webview payloads carried {id, flags}; the raw line keeps quotes intact.
      const line = result.line ?? [result.id, ...(result.flags ?? [])].join(" ");
      const outcome = await runLine(line, {
        registry,
        liveNodes,
        pick: ({ title, candidates, multi, nodes, preview }) => pick(title, candidates, multi, { nodes, preview }),
      });
      if (outcome.cancelled) return;
      present(outcome.result);
      // History gets successful invocations that carry arguments, in their
      // resolved form ("mute /Vermona MIDI"), so a re-run is never ambiguous.
      const invocation = outcome.line ?? line;
      if (outcome.result.code === ExitCode.OK && invocation.includes(" ")) {
        for (const listener of commandRunListeners) listener(invocation);
      }
      return;
    }
    // Non-command items (Live objects) are routed by `action` — modules
    // declare what an item should *do*, independent of its `type`.
    const handler = result.action ? resultHandlers.get(result.action) : undefined;
    if (!handler) {
      present(fail(ExitCode.NOT_FOUND, `no handler for "${result.type}" action "${result.action}"`));
      return;
    }
    console.log(`cmdAbl: run: item action ${result.action} (${result.type})`);
    try {
      await handler(result);
    } catch (e: unknown) {
      present(fail(ExitCode.FAILURE, e instanceof Error ? e.message : String(e)));
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
