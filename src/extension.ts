import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./core/command/commandRegistry.js";
import { appLog, logger } from "./core/log.js";
import { runBoard } from "./core/surfaces/board.js";
import { helpForPath, usageForPath } from "./core/command/commandTree.js";
import { createCommandProvider } from "./core/command/commandProvider.js";
import { buildCompletionData } from "./core/complete/completeSnapshot.js";
import type { CompletionData } from "./core/complete/complete.js";
import { type Provider, type PaletteItem, type PaletteResult, type CommandResult, ExitCode, fail, ok } from "./core/types.js";
import type { Module, ModuleApi } from "./modules/types.js";
import { startTriggerServer } from "./httpTrigger.js";
import { isAhkInstalled, isAhkSetupDone, isKarabinerInstalled, isKarabinerSetupDone, karabinerSourcePath, readKarabinerConfig, runRemoteScriptSetup, setKarabinerPaletteOpen, isSetupDone, REMOTE_SCRIPT_DOCS_URL } from "./core/setup/setup.js";
import { createSetupFlow } from "./core/setup/setupFlow.js";
import { gatherFacts } from "./core/setup/setupFacts.js";
import { openUrl } from "./core/setup/openUrl.js";
import * as fs from "node:fs";
import { registerBuiltins } from "./core/command/builtins.js";
import { reportBridge } from "./core/host/bridgeStatus.js";
import { getBridge } from "./ableton/bridge.js";
import { getTagCache } from "./ableton/tagCache.js";
import { paramDisplay, setId } from "./ableton/bridgeOps.js";
import { findRacks, getChainNameCache } from "./ableton/chainNames.js";
import { presentResult } from "./core/surfaces/present.js";
import { runLine } from "./core/command/run.js";
import { objectRowLine } from "./core/command/objectRow.js";
import { confirm } from "./core/surfaces/confirm.js";
import { pickNodes, pickTagNames } from "./core/surfaces/pick.js";
import { quoteIfNeeded } from "./core/command/tokenize.js";
import { uniquePath } from "./ableton/resolvePath.js";
import { createDialogQueue } from "./core/surfaces/dialogQueue.js";
import { createDefaultUi, type PickPreview, type StateChange, type Ui } from "./core/surfaces/ui.js";
import { createModuleFiles } from "./core/settings/files.js";
import { createSettingsRegistry, createSettingsStore } from "./core/settings/settings.js";
import { createSettingsFlow } from "./core/surfaces/settingsSurface.js";
import { createDefaultsStore } from "./core/command/defaultCommands.js";
import { attachConfigs } from "./core/command/configAttach.js";
import { createDefaultsFlow } from "./core/surfaces/defaultsSurface.js";
import { rootCommandOf } from "./core/command/parse.js";
import { bareBehaviour } from "./core/command/defaultCommands.js";
import { tokenFilePath } from "./ableton/bridgeToken.js";
import * as path from "node:path";
import { createUiGate, runHeadless } from "./core/host/headless.js";
import { withHelpLine } from "./core/surfaces/helpLine.js";
import { createDevRoutes, runTokenFilePath, type DevRoutes, writeRunToken } from "./devRoutes.js";
import { midiBlocked, midiLast, midiListen, onBlocked, onMidiEvent } from "./ableton/bridgeOps.js";
import { createMidiEngine } from "./core/midi/midiEngine.js";
import { createSetWatch } from "./core/host/setWatch.js";
import { createLivePages } from "./core/surfaces/livePage.js";
import { createMidiPort } from "./core/midi/midiPort.js";
import { createMidiListenRoute, logMidiEvent } from "./ableton/midiEvents.js";
import { buildObjectTree, flattenObjectTree, type ObjectNode } from "./ableton/objectTree.js";
import { readVolume, writeVolume, type VolumeTrack } from "./core/host/volume.js";
import { trackFor } from "./ableton/trackLookup.js";
import { MODULES } from "./modules/index.js";

const TRIGGER_PORT = 27184;

/** Set by build.ts: true in development builds, false in `--production` (the code behind it is removed). */
declare const CMDABL_DEV_ROUTES: boolean;
/** The extension's version (manifest.json), defined at build time. */
declare const CMDABL_VERSION: string;

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  // What this host provides, as types only (no values): evidence for "works in
  // Node but not here" bugs. Keep it; the answer belongs in docs/sdk-tree.md.
  const g = globalThis as Record<string, unknown>;
  const globals = ["URL", "URLSearchParams", "fetch", "structuredClone", "AbortController", "TextEncoder", "crypto"];
  logger("host").info(`host globals: ${globals.map((n) => `${n}=${typeof g[n]}`).join(", ")}`);
  // The extension's data folder: the SDK's storageDirectory when it answers (it is undefined in practice today),
  // else the macOS path the tokens use. A module's files go under modules/<its name>/ there.
  const dataFolder = context.environment.storageDirectory ?? path.dirname(tokenFilePath());
  const registry = new CommandRegistry();
  // Every dialog goes through this — the platform never opens an HTML page itself.
  // One queue: a dialog never opens while another is open (see core/surfaces/dialogQueue.ts).
  const dialogs = createDialogQueue();
  // The gate passes everything through to the real dialogs, except during a headless run (plan 0016).
  // cmdAbl's own settings (settings.json in the data folder); the palette page returns changes with its result.
  // Declared settings (plan 0019): core's groups are in the registry from the start, the modules declare theirs at activation.
  const settingsRegistry = createSettingsRegistry((text) => logger("settings").warn(text));
  const settingsStore = createSettingsStore({ base: dataFolder, registry: settingsRegistry, warn: (text) => logger("settings").warn(text) });
  // A page's gear (plan 0019): remembered here, taken by the run right after the board closed.
  let pendingGear: { surface: "board" } | undefined;
  // Live pages (plan 0018): a module's dialog may read from it through token-guarded routes of the trigger server.
  // Registered in release builds too; unavailable (data-page fallback) when the port is taken.
  let trigger: { listening(): boolean } | undefined;
  const livePages = createLivePages({ port: TRIGGER_PORT, available: () => trigger?.listening() === true });
  const gate = createUiGate(
    withHelpLine(
      createDefaultUi(context, dialogs, livePages, (gear) => {
        pendingGear = gear;
      }),
      async () => (await settingsStore.get())["ui.helpLine"],
    ),
  );
  const ui: Ui = gate.ui;
  // Default commands (plan 0019 §7): default_commands.json next to settings.json; a bare command word runs the line chosen for it.
  const defaultsStore = createDefaultsStore({ base: dataFolder, roots: () => registry.roots(), warn: (text) => logger("defaults").warn(text) });
  const defaultsFlow = createDefaultsFlow({ store: defaultsStore, ui, roots: () => registry.roots() });
  const settingsFlow = createSettingsFlow({
    registry: settingsRegistry,
    store: settingsStore,
    ui,
    log: (line) => logger("settings").warn(line),
    // A link row closed the settings page: the defaults page opens after the changes were saved.
    onOpen: (target, window) => defaultsFlow.openTarget(target, window),
    // The default-command rows the platform adds: one in cmdAbl's group (how many are set), one in a module's group (its command).
    links: async (group) => {
      const { count, lines } = await defaultsFlow.summary();
      if (group === "cmdabl") {
        return [{ key: "link:defaults", label: "Default commands", help: "A bare command word runs a line you choose: mute can run mute #drums. Opens its own page; \\mute still runs the plain command.", kind: "link", target: "defaults", summary: `${count} set` }];
      }
      const node = registry.roots().find((n) => n.name === group);
      if (!node) return [];
      return [
        {
          key: `link:defaults:${group}`,
          label: "Default command",
          help: `The line a bare ${group} runs (bare, it ${bareBehaviour(node)}; a default replaces that, and \\${group} brings it back).`,
          kind: "link",
          target: `defaults:${group}`,
          summary: lines[group] ?? "not set",
        },
      ];
    },
  });
  const providers: { provider: Provider; priority: number }[] = [];
  // The items of the palette that is open (or was opened last): a picked object row is found here.
  let paletteItems: PaletteItem[] = [];
  const commandRunListeners: Array<(invocation: string, typed?: string) => void> = [];
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
  /** The line the palette (or /show) is running now; the board's gear belongs to its command (plan 0019). */
  let activeLine: string | undefined;
  /** The settings group of the running command: its first word, when that module declared settings. Not for `;` chains. */
  function activeGroup(): string | undefined {
    if (activeLine === undefined) return undefined;
    const root = rootCommandOf(activeLine, registry.roots());
    return root !== undefined && settingsFlow.has(root) ? root : undefined;
  }

  function showFeedback(message: string): void {
    ui.notify({ text: message, code: ExitCode.OK });
  }

  // ── core: the only commands baked in (see src/core/command/builtins.ts) ───────────
  // `cmdabl curve` measures the first regular track (plan 0012): no fader moves, nothing is written.
  const firstTrack = () => liveNodes().find((n) => n.kind === "track" && n.scope === "regular");
  // The setup page (plan 0021): rows from facts, buttons run `cmdabl setup script` or open a link, then the page comes again.
  const hostStart = Date.now();
  const setupFlow = createSetupFlow({
    notifyAnswer: (request) => ui.notifyAnswer(request),
    headless: () => gate.active(),
    facts: (copyFailed) =>
      gatherFacts({
        port: TRIGGER_PORT,
        controlSurfaceUrl: REMOTE_SCRIPT_DOCS_URL,
        triggerInstalled: process.platform === "win32" ? isAhkInstalled : isKarabinerInstalled,
        triggerRuleThere: process.platform === "win32" ? isAhkSetupDone : isKarabinerSetupDone,
        karabinerConfig: readKarabinerConfig,
        ping: () => getBridge().ping(),
        hostStart,
        dataFolder,
        copyFailed,
      }),
    // The page's own commands only (the flow looks them up in the page it sent): run through the normal path, without a screen.
    runCommand: async (line) =>
      (await runLine(line, { ...runBase, takeFill: () => undefined, pick: async () => null, pickTags: async () => null })).result,
    openUrl,
    settings: settingsStore,
    files: createModuleFiles({ base: dataFolder, module: () => "setup", warn: (text) => logger("setup").warn(text) }),
    version: CMDABL_VERSION,
    warn: (text) => logger("setup").warn(text),
    note: (text) => logger("setup").info(text),
    copyScript: () => {
      const step = runRemoteScriptSetup();
      return step.ok ? ok(step.text) : fail(ExitCode.FAILURE, step.text);
    },
  });
  registerBuiltins(registry, {
    setup: setupFlow,
    simulate: CMDABL_DEV_ROUTES, // the hidden `cmdabl setup --simulate <state>` (development builds only)
    settings: settingsFlow,
    defaults: defaultsFlow,
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
  // MIDI mapping (plan 0018): pushed events go to the engine, which runs the bound lines headless (no dialogs,
  // not in the history). `map.enabled` is read from settings.json, remembered for a second so a fader stream costs no disk.
  let enabledAt = Number.NEGATIVE_INFINITY;
  let enabledValue = true;
  const mapEnabled = async (): Promise<boolean> => {
    const t = Date.now();
    if (t - enabledAt < 1000) return enabledValue;
    enabledValue = (await settingsStore.get())["map.enabled"];
    enabledAt = t;
    return enabledValue;
  };
  const midiRuntime = createMidiPort({
    engine: createMidiEngine({ run: (line) => runHeadless(line, runBase, gate), enabled: mapEnabled }),
    listen: (controls, options) => midiListen(getBridge(), controls, options),
    last: (since) => midiLast(getBridge(), since),
    blocked: midiBlocked,
    onBlocked,
    statusBar: async () => (await settingsStore.get())["midi.statusBar"],
    enabled: mapEnabled,
    setEnabled: async (on) => {
      enabledValue = on; // in effect at once, saved or not
      enabledAt = Date.now();
      return settingsStore.set({ "map.enabled": on });
    },
  });
  onMidiEvent((event) => void midiRuntime.intake(event));
  // The Set's id, polled once a module listens (api.onSetChange): the script may come up after the extension, and a new Set has another id.
  const setWatch = createSetWatch({
    read: async () => {
      const reply = await getBridge().request("set_id", {}, { token: true });
      if (!reply.ok) return { ok: false };
      const id = reply.value.id;
      return { ok: true, id: typeof id === "string" && id !== "" ? id : null };
    },
  });
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
    midi: midiRuntime.port,
    onSetChange: (listener) => setWatch.onChange(listener),
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
      defaults: () => defaultsStore.peek(),
    },
    pick: (title, candidates, multi, options) => pick(title, candidates, multi, { fill: options?.fill, state: options?.state }),
    confirm: (message, confirmLabel) => confirm(ui, message, confirmLabel),
    // Declared settings; a module sees its own namespace (replaced per module below).
    settings: {
      declare: () => void logger("settings").warn("a module declared settings before it was named; dropped"),
      get: async () => undefined as never,
    },
    ui: {
      // The gear (plan 0019) is drawn only for a command that has settings: `tag --list` → the group `tag`.
      board: (request) => runBoard(ui, { ...request, ...(activeGroup() !== undefined ? { gear: true } : {}) }),
      livePage: (name, html, width, height, routes) => ui.livePage(name, html, width, height, routes),
    },
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
      settings: {
        declare: (group: Parameters<ModuleApi["settings"]["declare"]>[0]) => {
          if (!named) return void tagged().warn("settings: declare after the module has a name (Module.name or a first commands.add); dropped");
          settingsRegistry.declare(source, group); // problems are warnings, logged by the registry
        },
        get: async <T = unknown>(name: string): Promise<T> => {
          try {
            const key = typeof name === "string" && name.includes(".") ? name : `${source}.${name}`;
            if (!key.startsWith(`${source}.`)) return undefined as T;
            return (await settingsStore.get())[key] as T;
          } catch {
            return undefined as T;
          }
        },
      },
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
  // `<command> config` for every top-level command but man/help (plan 0019): its settings group, or just its default-command row.
  attachConfigs(registry, {
    make: (name) => ({ name: "config", summary: `open the settings of ${name}`, run: () => settingsFlow.open({ group: name, only: true }) }),
    groups: () => settingsRegistry.groups().map((g) => g.id),
    warn: (text) => logger("settings").warn(text),
  });
  void defaultsStore.get().catch(() => {}); // primes `api.commands.defaults()`
  // A command that names a completer nobody registered would complete nothing: say so once, at startup.
  for (const problem of registry.unknownCompleters()) logger("host").warn(problem);

  // ── HTTP trigger server ──────────────────────────────────────────────────
  // Karabiner (or any external tool) can POST/GET http://127.0.0.1:27184/open
  // to open the command palette without a context menu; GET /state reports
  // open|closed; POST /reset is the supported recovery for a hung dialog and
  // GET /bridge a diagnostic for measuring round trips.
  // Development builds only (plan 0016): POST /run and GET /log for the agents' test access.
  let devRoutes: DevRoutes | undefined;
  let midiRoute: ReturnType<typeof createMidiListenRoute> | undefined;
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
      // MIDI (plan 0018): a debug line per pushed event; /midi-listen changes what the script forwards.
      const midiLog = logger("midi");
      onMidiEvent((event) => logMidiEvent(midiLog, event));
      midiRoute = createMidiListenRoute({
        token,
        listen: async (controls, monitor) => {
          const r = await midiListen(getBridge(), controls, { monitor });
          return r.ok ? `forwarding ${r.value.count} controls${r.value.monitor ? " (monitor)" : ""}` : `midi_listen failed: ${r.text}`;
        },
      });
    } else {
      logger("host").warn(`development routes off: cannot write ${file}`);
    }
  }
  trigger = startTriggerServer(TRIGGER_PORT, () => {
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
  }, async () => (await reportBridge(getBridge())).line, (req, res) => midiRoute?.(req, res) === true || devRoutes?.(req, res) === true, (req, res) => livePages.handle(req, res), () => {
    try {
      return fs.readFileSync(karabinerSourcePath(), "utf8");
    } catch {
      return null;
    }
  });

  // The Karabiner rule only fires while `cmdabl_open` is 0. If a previous host
  // was stopped with the palette open, the flag would stay at 1 and ":" would
  // silently do nothing — so start from a known state.
  setKarabinerPaletteOpen(false);

  // ── startup hint ─────────────────────────────────────────────────────────
  if (!isSetupDone()) {
    logger("host").info("keyboard trigger not configured. Open the palette and run: cmdabl setup");
  }
  // setup.autoScript: copy a newer Remote Script now, without a dialog (the page then says "restart Live once").
  setupFlow.warmUp();
  void setupFlow.autoCopy();

  // What a run needs besides its two pick surfaces: the palette and the headless run share it.
  const runBase = {
    registry,
    defaults: () => defaultsStore.get(),
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
    // The board's gear (plan 0019): the page closed with {settings: true}; the settings open, then the same line runs again
    // (also after Esc on the settings). The module only saw a closed board.
    let outcome: Awaited<ReturnType<typeof runLine>>;
    for (let round = 0; ; round++) {
      pendingGear = undefined;
      activeLine = line;
      try {
        outcome = await runLine(line, {
          ...runBase,
          takeFill,
          // The platform's own lists: Tab may put a single-select row into the prompt.
          pick: ({ title, candidates, multi, nodes, preview, details, state }) =>
            pick(title, candidates, multi, { nodes, preview, details, state, fill: true }),
          pickTags: (request) => pickTagNames(ui, request),
        });
      } finally {
        activeLine = undefined;
      }
      const gear = pendingGear as { surface: "board" } | undefined;
      pendingGear = undefined;
      const group = gear?.surface === "board" ? rootCommandOf(line, registry.roots()) : undefined;
      if (group === undefined || round >= 20 || !settingsFlow.has(group)) break;
      await openSettings({ group, only: true });
    }
    if (outcome.fill !== undefined) return outcome.fill;
    if (outcome.cancelled) return;
    present(outcome.result);
    // History gets successful invocations that carry arguments, in their
    // resolved form ("mute /Bass"), so a re-run is never ambiguous.
    const invocation = outcome.line ?? line;
    if (remember && outcome.result.code === ExitCode.OK && invocation.includes(" ")) {
      for (const listener of commandRunListeners) listener(invocation, outcome.typed);
    }
    return undefined;
  }

  /**
   * The settings page for a gear. What it saved goes to the log, not to a message (the page we came from opens again at
   * once); a failure to save is shown.
   */
  async function openSettings(options: { group?: string; only?: boolean }): Promise<void> {
    const result = await settingsFlow.open(options);
    if (result.code !== ExitCode.OK) present(result);
    else if (result.message) logger("settings").info(result.message);
  }

  /** The single place results become user-visible (see src/core/surfaces/present.ts). */
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
  const warnedCompleters = new Set<string>();
  let tagsAwaited = false; // the cold tag cache is awaited once per session, never again
  async function snapshotCompletion(): Promise<CompletionData | undefined> {
    const started = Date.now();
    try {
      const data = await buildCompletionData({
        roots: registry.roots(),
        defaults: () => defaultsStore.get(),
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
        // A slow synchronous completer would warn at every open: once per line per session, the numbers stay at debug.
        warn: (line) => {
          if (warnedCompleters.has(line.split(" blocked for ")[0]!)) return logger("completion").debug(line);
          warnedCompleters.add(line.split(" blocked for ")[0]!);
          logger("completion").warn(line);
        },
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

  let setupChecked = false;
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
      // The setup page opens by itself once per start, on the first use (plan 0021 §4): a dialog during activate() is not
      // known to be safe, and a use is when the user is here. The palette follows when it closes.
      if (!setupChecked) {
        setupChecked = true;
        await setupFlow.openIfNeeded();
      }
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
