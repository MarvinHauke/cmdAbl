import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./core/commandRegistry.js";
import { appLog, logger } from "./core/log.js";
import { runBoard } from "./core/board.js";
import { helpForPath, usageForPath } from "./core/commandTree.js";
import { createCommandProvider } from "./core/commandProvider.js";
import { buildCompletionData } from "./core/completeSnapshot.js";
import type { CompletionData } from "./core/complete.js";
import { type Provider, type PaletteItem, type PaletteResult, type CommandResult, ExitCode, fail } from "./core/types.js";
import type { Module, ModuleApi } from "./modules/types.js";
import { startTriggerServer } from "./httpTrigger.js";
import { isSetupDone, setKarabinerPaletteOpen } from "./core/setup.js";
import { registerBuiltins } from "./core/builtins.js";
import { reportBridge } from "./core/bridgeStatus.js";
import { getBridge } from "./ableton/bridge.js";
import { getTagCache } from "./ableton/tagCache.js";
import { paramDisplay, setId } from "./ableton/bridgeOps.js";
import { findRacks, getChainNameCache } from "./ableton/chainNames.js";
import { presentResult } from "./core/present.js";
import { runLine } from "./core/run.js";
import { objectRowLine } from "./core/objectRow.js";
import { confirm } from "./core/confirm.js";
import { pickNodes, pickTagNames } from "./core/pick.js";
import { quoteIfNeeded } from "./core/tokenize.js";
import { uniquePath } from "./ableton/resolvePath.js";
import { createDialogQueue } from "./core/dialogQueue.js";
import { createDefaultUi, type PickPreview, type StateChange, type Ui } from "./core/ui.js";
import { createModuleFiles } from "./core/files.js";
import { tokenFilePath } from "./ableton/bridgeToken.js";
import * as path from "node:path";
import { createUiGate, runHeadless } from "./core/headless.js";
import { createDevRoutes, runTokenFilePath, type DevRoutes, writeRunToken } from "./devRoutes.js";
import { buildObjectTree, flattenObjectTree, type ObjectNode } from "./ableton/objectTree.js";
import { readVolume, writeVolume, type VolumeTrack } from "./core/volume.js";
import { trackFor } from "./ableton/trackLookup.js";
import { MODULES } from "./modules/index.js";

const TRIGGER_PORT = 27184;

/** Set by build.ts: true in development builds, false in `--production` (the code behind it is removed). */
declare const CMDABL_DEV_ROUTES: boolean;

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  // What this host provides, as types only (no values): evidence for "works in
  // Node but not here" bugs. Keep it; the answer belongs in docs/sdk-tree.md.
  const g = globalThis as Record<string, unknown>;
  const globals = ["URL", "URLSearchParams", "fetch", "structuredClone", "AbortController", "TextEncoder", "crypto"];
  logger("host").info(`host globals: ${globals.map((n) => `${n}=${typeof g[n]}`).join(", ")}`);
  const registry = new CommandRegistry();
  // Every dialog goes through this — the platform never opens an HTML page itself.
  // One queue: a dialog never opens while another is open (see core/dialogQueue.ts).
  const dialogs = createDialogQueue();
  // The gate passes everything through to the real dialogs, except during a headless run (plan 0016).
  const gate = createUiGate(createDefaultUi(context, dialogs));
  const ui: Ui = gate.ui;
  const providers: { provider: Provider; priority: number }[] = [];
  // The items of the palette that is open (or was opened last): a picked object row is found here.
  let paletteItems: PaletteItem[] = [];
  const commandRunListeners: Array<(invocation: string) => void> = [];
  const pickListeners: Array<(candidates: ObjectNode[], chosen: ObjectNode[] | null) => void> = [];

  const liveNodes = () => flattenObjectTree(buildObjectTree(context));

  // Set when a pick list answered "fill" (Tab): the text for the next prompt.
  let pendingFill: string | undefined;
  const takeFill = (): string | undefined => {
    const text = pendingFill;
    pendingFill = undefined;
    return text;
  };

  /** The one pick list — used by the platform for ambiguous addresses and by modules. */
  async function pick(
    title: string,
    candidates: ObjectNode[],
    multi = false,
    extra: {
      nodes?: ObjectNode[];
      preview?: PickPreview;
      details?: string[];
      fill?: boolean;
      state?: { label: string; values: Array<boolean | null>; change?: StateChange };
    } = {},
  ): Promise<ObjectNode[] | null> {
    // A module's own pick has no Live Set at hand; unique labels need it.
    const nodes = extra.nodes ?? liveNodes();
    const answer = await pickNodes(ui, {
      title,
      candidates,
      multi,
      nodes,
      preview: extra.preview,
      details: extra.details,
      fill: extra.fill,
      state: extra.state,
    });
    if (answer && !Array.isArray(answer)) {
      // Tab: the object goes into the prompt as ` <unique path>`; the pick counts as cancelled.
      pendingFill = ` ${quoteIfNeeded(uniquePath(nodes, answer.fill))}`;
      for (const listener of pickListeners) listener(candidates, null);
      return null;
    }
    for (const listener of pickListeners) listener(candidates, answer);
    return answer;
  }
  let isOpen = false;

  function showFeedback(message: string): void {
    ui.notify({ text: message, code: ExitCode.OK });
  }

  // ── core: the only commands baked in (see src/core/builtins.ts) ───────────
  // `cmdabl curve` measures the first regular track (plan 0012): no fader moves, nothing is written.
  const firstTrack = () => liveNodes().find((n) => n.kind === "track" && n.scope === "regular");
  registerBuiltins(registry, {
    bridge: () => getBridge(),
    curve: {
      hasTrack: () => firstTrack() !== undefined,
      display: async (values) => {
        const track = firstTrack();
        return track ? paramDisplay(getBridge(), track, "volume", values) : { ok: false, code: ExitCode.NOT_FOUND, text: "curve: no regular track" };
      },
    },
  });

  // ── default modules ──────────────────────────────────────────────────────
  // The extension's data folder: the SDK's storageDirectory when it answers (it is undefined in practice today),
  // else the macOS path the tokens use. A module's files go under modules/<its name>/ there.
  const dataFolder = context.environment.storageDirectory ?? path.dirname(tokenFilePath());
  const moduleApi: ModuleApi = {
    get bridge() {
      return getBridge();
    },
    liveSet: { nodes: liveNodes },
    tracks: {
      transaction: (fn) => {
        const result = context.withinTransaction(fn);
        // A returned promise (async writes grouped into the step): answer one that never rejects.
        return result && typeof (result as Promise<unknown>).then === "function"
          ? Promise.resolve(result).then(() => undefined, (e: unknown) => void logger("host").warn(`transaction: ${e instanceof Error ? e.message : String(e)}`))
          : undefined;
      },
      // Only a track node has a volume; a device or chain would give its CONTAINING track.
      volume: (node) => readVolume(node.kind === "track" ? (trackFor(context, node) as unknown as VolumeTrack | null) : null),
      setVolume: (node, value) => writeVolume(node.kind === "track" ? (trackFor(context, node) as unknown as VolumeTrack | null) : null, value),
      // Only a track node has a track; a device or chain would give its CONTAINING track.
      track: (node) => (node.kind === "track" ? trackFor(context, node) : null),
    },
    // The Set's id lives in the Set, written and read by the Remote Script (operation set_id).
    set: { id: (create) => setId(getBridge(), create === true) },
    // Replaced per module below (a module sees its own folder only). Before a module's first command names it,
    // this folder is modules/module/; modules call files from a run, after activation.
    files: createModuleFiles({ base: dataFolder, module: () => "module", warn: (text) => logger("module").warn(text) }),
    log: (line) => logger("module").info(line), // replaced per module below
    logger: logger("module") as ModuleApi["logger"],
    dialog: (html, width, height, name = "module page") => ui.page(name, html, width, height),
    commands: {
      add: (command) => void registry.add(command),
      roots: () => registry.roots(),
      help: (path) => helpForPath(registry.roots(), path),
      usage: (path) => usageForPath(registry.roots(), path),
      completer: (key, source) => registry.completer(key, source),
    },
    pick: (title, candidates, multi, options) => pick(title, candidates, multi, { fill: options?.fill, state: options?.state }),
    confirm: (message, confirmLabel) => confirm(ui, message, confirmLabel),
    ui: { board: (request) => runBoard(ui, request) },
    pickTags: (title, rows, options) => pickTagNames(ui, { title, tags: rows, ...options, multi: options?.multi ?? true }),
    tags: {
      refresh: () => getTagCache().refreshNow(getBridge()),
      of: (node) => getTagCache().get(node.scope, node.route, node.name) ?? [],
      write: (node, tags) => getTagCache().write(getBridge(), node, tags),
    },
    onPick: (listener) => pickListeners.push(listener),
    registerProvider: (provider, priority = 0) => providers.push({ provider, priority }),
    onCommandRun: (listener) => commandRunListeners.push(listener),
    showFeedback,
  };
  /**
   * The api one module gets: the shared ports, with log lines tagged by the module's name
   * (`mod.name`, else the first command it declares).
   */
  function moduleApiFor(mod: Module): ModuleApi {
    let source = mod.name ?? "module";
    let named = mod.name !== undefined;
    const tagged = () => logger(source);
    return Object.assign(Object.create(moduleApi) as ModuleApi, {
      files: createModuleFiles({ base: dataFolder, module: () => source, warn: (text) => tagged().warn(text) }),
      log: (line: string) => tagged().info(line),
      logger: {
        debug: (text: string) => tagged().debug(text),
        info: (text: string) => tagged().info(text),
        warn: (text: string) => tagged().warn(text),
        error: (text: string) => tagged().error(text),
      },
      commands: {
        ...moduleApi.commands,
        add: (command: Parameters<ModuleApi["commands"]["add"]>[0]) => {
          if (!named) {
            source = command.name;
            named = true;
          }
          moduleApi.commands.add(command);
        },
      },
    });
  }
  // The command list itself is a provider (priority 0); modules add theirs.
  moduleApi.registerProvider(createCommandProvider(registry));
  for (const mod of MODULES) mod.activate(moduleApiFor(mod));
  // A command that names a completer nobody registered would complete nothing: say so once, at startup.
  for (const problem of registry.unknownCompleters()) logger("host").warn(problem);

  // ── HTTP trigger server ──────────────────────────────────────────────────
  // Karabiner (or any external tool) can POST/GET http://127.0.0.1:27184/open
  // to open the command palette without a context menu; GET /state reports
  // open|closed; POST /reset is the supported recovery for a hung dialog and
  // GET /bridge a diagnostic for measuring round trips.
  // Development builds only (plan 0016): POST /run and GET /log for the agents' test access.
  let devRoutes: DevRoutes | undefined;
  if (CMDABL_DEV_ROUTES) {
    const file = runTokenFilePath();
    const token = writeRunToken(file);
    if (token) {
      devRoutes = createDevRoutes({
        token,
        run: (line) => runHeadless(line, runBase, gate),
        blocked: () => (isOpen || dialogs.describe() !== null ? "a palette or dialog is open" : null),
        logLines: (count) => appLog.lines(count),
        // POST /show (plan 0016 §5): the line runs as in the palette, with real dialogs, and is not remembered.
        show: (line) => void showLine(line),
      });
      logger("host").info(`development routes on: POST /run, GET /log (Bearer token in ${file})`);
    } else {
      logger("host").warn(`development routes off: cannot write ${file}`);
    }
  }
  startTriggerServer(TRIGGER_PORT, () => {
    context.commands.executeCommand("cmdabl.open");
  }, () => isOpen || dialogs.describe() !== null, () => {
    const was = dialogs.reset();
    // A headless run that never ended (plan 0016) holds the dialogs shut and the /run route busy.
    const released = devRoutes?.release() === true;
    const gateReleased = gate.release() || released;
    const note = gateReleased ? "; run gate released" : "";
    if (was) return `dialog queue reset (was: ${was.name})${note}`;
    if (gateReleased) return "run gate released";
    return isOpen ? "no dialog open; a command is still running" : "no dialog was open";
  }, async () => (await reportBridge(getBridge())).line, devRoutes);

  // The Karabiner rule only fires while `cmdabl_open` is 0. If a previous host
  // was stopped with the palette open, the flag would stay at 1 and ":" would
  // silently do nothing — so start from a known state.
  setKarabinerPaletteOpen(false);

  // ── startup hint ─────────────────────────────────────────────────────────
  if (!isSetupDone()) {
    logger("host").info("keyboard trigger not configured. Open the palette and run: cmdabl setup");
  }

  // What a run needs besides its two pick surfaces: the palette and the headless run share it.
  const runBase = {
    registry,
    liveNodes,
    bridge: () => getBridge(),
    refreshTags: async () => {
      const read = await getTagCache().refreshNow(getBridge());
      return read.ok ? null : fail(read.code, read.text);
    },
    // Nested rack chains are tree nodes only while their names are cached: read them first.
    // Without a running script every rack stays "missing": ask nothing then (no 0.5 s wait per command).
    refreshStructure: () =>
      getBridge().state() === "unavailable"
        ? Promise.resolve()
        : getChainNameCache().refreshNow(findRacks(context.application.song), getBridge()),
  };

  // ── open command mode ────────────────────────────────────────────────────
  // Act on what the prompt surface returned.
  /** Runs what the palette returned; resolves with text to open the palette with again (Tab on a pick list), if any. */
  async function dispatch(result: PaletteResult, remember = true): Promise<string | undefined> {
    pendingFill = undefined; // a fill left over from a pick outside a run must not end this command
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
        return undefined;
      }
      line = mapped;
    }
    const outcome = await runLine(line, {
      ...runBase,
      takeFill,
      // The platform's own lists: Tab may put a single-select row into the prompt.
      pick: ({ title, candidates, multi, nodes, preview, details, state }) =>
        pick(title, candidates, multi, { nodes, preview, details, state, fill: true }),
      pickTags: (request) => pickTagNames(ui, request),
    });
    if (outcome.fill !== undefined) return outcome.fill;
    if (outcome.cancelled) return;
    present(outcome.result);
    // History gets successful invocations that carry arguments, in their
    // resolved form ("mute /Bass"), so a re-run is never ambiguous.
    const invocation = outcome.line ?? line;
    if (remember && outcome.result.code === ExitCode.OK && invocation.includes(" ")) {
      for (const listener of commandRunListeners) listener(invocation);
    }
    return undefined;
  }

  /** The single place results become user-visible (see src/core/present.ts). */
  function present(outcome: CommandResult): void {
    presentResult(outcome, (text, link, sections) =>
      ui.notify({ text, code: outcome.code, ...(link ? { link } : {}), ...(sections ? { sections } : {}) }),
    );
  }

  /** Run `line` as the palette would (real dialogs) without remembering it; an empty line opens the palette. Never throws. */
  async function showLine(line: string): Promise<void> {
    if (line.trim() === "") {
      void openPalette();
      return;
    }
    if (isOpen || dialogs.describe() !== null || gate.active()) return;
    isOpen = true; // the palette trigger and /run answer "busy" meanwhile
    setKarabinerPaletteOpen(true);
    let fill: string | undefined;
    try {
      fill = await dispatch({ type: "command", id: line, line }, false);
    } catch (e: unknown) {
      logger("host").error(e instanceof Error ? e.message : String(e));
    } finally {
      isOpen = false;
      if (dialogs.describe() === null) setKarabinerPaletteOpen(false);
    }
    if (fill !== undefined) void openPalette(fill);
  }

  /** What the palette completes arguments from (plan 0006), taken once at open. Never throws. */
  let tagsAwaited = false; // the cold tag cache is awaited once per session, never again
  async function snapshotCompletion(): Promise<CompletionData | undefined> {
    const started = Date.now();
    try {
      const data = await buildCompletionData({
        roots: registry.roots(),
        completers: registry.completers(),
        nodes: liveNodes,
        // Stale-while-revalidate, like the tree build: building the tree (liveNodes) already schedules a
        // background refresh of the tags and the rack chain names, so an open palette sees what the last
        // refresh read. Only the very first snapshot of a session waits for a cold tag cache (so the
        // first `#` is not empty); every later open starts a background refresh and never waits.
        refresh: () => {
          if (getBridge().state() === "unavailable") return Promise.resolve();
          const tags = getTagCache();
          if (!tags.ready() && !tagsAwaited) {
            tagsAwaited = true;
            return tags.refreshNow(getBridge()).then((read) => {
              if (!read.ok) logger("completion").debug(`tag cache not read (exit ${read.code}); later opens will not wait for it`);
              else if (!tags.ready()) logger("completion").debug("tag cache still not ready after the read (a write landed meanwhile); later opens will not wait for it");
            });
          }
          return Promise.resolve(); // building the tree schedules the background refresh
        },
        debug: (line) => logger("completion").debug(line),
      });
      logger("completion").debug(
        `snapshot: ${data.paths.length} paths, ${data.tags.length} tags, ${Object.keys(data.completions).length} completers, ${JSON.stringify(data).length} bytes, ${Date.now() - started} ms`,
      );
      return data;
    } catch (e: unknown) {
      logger("completion").warn(`snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }

  async function openPalette(initial?: string): Promise<void> {
    const shown = dialogs.describe();
    if (gate.active()) {
      logger("host").info("trigger ignored: a headless run is going");
      return;
    }
    if (isOpen || shown) {
      // "isOpen but nothing shown" means a command is still running — the case to diagnose.
      logger("host").info(`trigger ignored: ${shown ?? "a command is still running (no dialog open)"}`);
      return;
    }
    isOpen = true;
    setKarabinerPaletteOpen(true);
    try {
      // Snapshot every provider's items, then let the webview search them.
      // Stable sort by priority (lower first); ties keep registration order.
      const ordered = [...providers].sort((a, b) => a.priority - b.priority);
      // The completion snapshot is taken side by side with the providers: the palette opens as soon as both are ready.
      const [itemLists, completion] = await Promise.all([Promise.all(ordered.map((p) => p.provider.getItems())), snapshotCompletion()]);
      const items = itemLists.flat();
      paletteItems = items;
      // Tab on a pick list puts an object into the prompt: reopen with it (same queue, same guard).
      for (;;) {
        const result = await ui.prompt({ items, completion, ...(initial !== undefined ? { initial: { text: initial, cursor: 0 } } : {}) });
        initial = result ? await dispatch(result) : undefined;
        if (initial === undefined) break;
      }
    } catch (e: unknown) {
      logger("host").error(e instanceof Error ? e.message : String(e));
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
