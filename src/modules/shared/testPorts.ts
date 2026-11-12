import type { ObjectNode } from "../../ableton/objectTree.js";
import { createFakeBridge, type FakeBridge, type FakeBridgeOptions } from "../../ableton/bridgeFake.js";
import type { Command } from "../../core/command/commandRegistry.js";
import { helpForPath, unknownCompleterKeys, usageForPath } from "../../core/command/commandTree.js";
import type { Completer } from "../../core/complete/complete.js";
import type { LiveRoutes } from "../../core/surfaces/livePage.js";
import { formatControl, validateBinding } from "../../core/midi/midi.js";
import type { MidiBinding } from "../../core/midi/midiEngine.js";
import type { MidiControl } from "../../core/midi/midi.js";
import type { MidiMessage as StoredMidiMessage } from "../../ableton/bridgeOps.js";
import { ok, type CommandResult, type Provider } from "../../core/types.js";
import type { StateChange } from "../../core/surfaces/ui.js";
import { MAX_FILE_BYTES, validFileName } from "../../core/settings/files.js";
import type { Loop, ModuleApi, PickRow, SettingDef, TagRow, TrackHandle, Transport } from "../types.js";

// A ModuleApi made of fakes, so a module's `activate` and its commands' `run`
// can be tested without Live: an in-memory bridge, a scripted object tree,
// recorded track writes, log lines and dialogs. Used by module tests only.

export interface FakeApiOptions {
  nodes?: ObjectNode[];
  bridge?: FakeBridgeOptions;
  /** What the dialog answers (the string a page returns on close); null or empty = dismissed. */
  dialogAnswer?: string | null;
  /** What `api.settings.gearAvailable()` answers (default false). */
  gearAvailable?: boolean;
  /** What `api.commands.run` answers (default `ok()`); the call is recorded in `fake.commandRuns`. */
  runResult?: (line: string) => CommandResult;
  /** What `api.pick` answers (default: cancelled). Registered `onPick` listeners are notified like the platform does. */
  pickAnswer?: (candidates: ObjectNode[], multi: boolean) => ObjectNode[] | null;
  /** What `api.confirm` answers (default: false, i.e. cancelled). */
  confirmAnswer?: boolean;
  /** What `api.pickRows` answers: the index chosen (default: cancelled; a disabled row counts as cancelled). */
  pickRowsAnswer?: (rows: PickRow[], cursor: number | undefined) => number | null;
  /** What `api.pickTags` answers (default: cancelled). */
  pickTagsAnswer?: (rows: TagRow[]) => string[] | null;
  /** Tags per node (by `handleId`) the fake `api.tags` starts with; writes land in `fake.tagStore`. */
  tags?: Record<string, string[]>;
  /** The Set's id the fake `api.set.id` starts with (default: none yet; `id(true)` then makes "fake-set-id"). */
  setId?: string | null;
  /** The transport the fake `api.set.transport` answers (default: null, i.e. no script); `setLoop` writes into its `loop`. */
  transport?: Transport | null;
  /** When set, `api.set.setLoop` answers this failure and leaves the loop alone (Live refusing a value: code 1). */
  setLoopFails?: { code: 1 | 5; text: string } | null;
  /** When set, `api.set.jump` answers this failure and leaves the position alone. */
  jumpFails?: { code: 1 | 5; text: string } | null;
  /** Files the fake `api.files` starts with, by name. */
  files?: Record<string, string>;
  /** The messages the fake script has kept (`api.midi.last` returns those after `since`). */
  midiMessages?: StoredMidiMessage[];
  /** Setting values the fake `api.settings.get` answers, by full key (a declared key without one answers its default). */
  settings?: Record<string, unknown>;
  /** What `api.commands.defaults()` returns (default: none). */
  defaults?: Record<string, string>;
}

export interface FakeApi {
  api: ModuleApi;
  bridge: FakeBridge;
  /** The lines `api.commands.run` was asked to run, with the call's `allow` if given. */
  commandRuns: Array<{ line: string; allow?: string[] }>;
  /** Commands the module declared, in order. */
  commands: Command[];
  providers: Provider[];
  logs: string[];
  feedback: string[];
  /** The `state` options `api.pick` was given, in order. */
  pickStates: Array<{ label: string; values: Array<boolean | null>; change?: StateChange }>;
  /** Every line written through `api.logger`, with its level (`api.log` lines are in `logs` as well). */
  logged: Array<{ level: "debug" | "info" | "warn" | "error"; text: string }>;
  /** The messages `api.confirm` was asked. */
  confirms: string[];
  /** The row lists `api.pickRows` showed. */
  rowLists: Array<{ title: string; rows: PickRow[]; cursor?: number }>;
  /** The tag lists `api.pickTags` showed (title and rows). */
  tagLists: Array<{ title: string; rows: TagRow[]; allowNew?: boolean }>;
  /** Tags by node `handleId`; `api.tags.write` replaces the entry (empty removes it). */
  tagStore: Map<string, string[]>;
  dialogs: Array<{ html: string; width: number; height: number; name?: string; gear?: boolean }>;
  /** The live pages `api.ui.livePage` was asked to show, with their route functions (call them to test the data a page would poll). */
  livePages: Array<{ name: string; html: string; width: number; height: number; routes: LiveRoutes; run?: string[]; onClose?: string }>;
  /** Track state by handle id; writes land here. */
  tracks: Map<string, TrackHandle>;
  /** Volumes (0..1) written through the fake's `tracks.setVolume`, by handle id; unset reads 0.85. */
  volumes: Map<string, number>;
  /** How many transactions were opened. */
  transactions: number;
  /** Names the fake `api.files.readResult` fails on (`read` still answers null for them). */
  unreadableFiles: Set<string>;
  /** The fake `api.files`, by name; writes land here. */
  fileStore: Map<string, string>;
  /** The Set's id now (`api.set.id(true)` fills it when empty). */
  setId: string | null;
  /** The fake transport now (null = no script); `api.set.setLoop` replaces its `loop`. */
  transport: Transport | null;
  /** The failure `api.set.setLoop` answers now (null = none); tests may set it. */
  setLoopFails: { code: 1 | 5; text: string } | null;
  /** The failure `api.set.jump` answers now (null = none); tests may set it. */
  jumpFails: { code: 1 | 5; text: string } | null;
  /** The times `api.set.jump` was asked for, in order (failed asks included). */
  jumps: number[];
  /** The bindings last given to `api.midi.setBindings` (rows with `{}` and press/release are refused, as in the engine). */
  midiBindings: MidiBinding[];
  /** Listeners registered with `api.onSetChange`; call them to simulate a Set change. */
  setListeners: Array<(setId: string | null) => void>;
  /** Listeners of `api.midi.onEvent`; call them with a MidiEvent to simulate a pushed message. */
  eventListeners: Array<(event: import("../../ableton/bridgeOps.js").MidiEvent) => void>;
  /** What the fake `api.midi.blocked()` answers (default none); call `blockedListeners` after changing it to simulate a map rebuild. */
  midiBlocked: string[] | null;
  blockedListeners: Array<(blocked: string[] | null) => void>;
  /** The fake `midi.statusBar` (default false). */
  midiStatusBar: boolean;
  /** The fake `map.enabled` (default true). */
  mapEnabled: boolean;
  /** Every `api.midi.listen` call, in order. */
  midiListens: Array<{ controls: "all" | "none" | readonly MidiControl[]; monitor: boolean }>;
  /** The groups the module declared with `api.settings.declare`, in order. */
  settingGroups: Array<{ heading: string; items: SettingDef[] }>;
  /** The values the fake `api.settings.get` answers, by full key; change them to simulate the Settings page. */
  settingValues: Record<string, unknown>;
  /** The completers the module registered, by key. */
  completers: Map<string, Completer>;
  /**
   * Command nodes that name a completer key the module did not register, as readable lines. A module's
   * test asserts this is empty (the platform only warns at activation).
   */
  unknownCompleters(): string[];
}

export function createFakeApi(options: FakeApiOptions = {}): FakeApi {
  const bridge = createFakeBridge(options.bridge);
  const pickListeners: Array<(candidates: ObjectNode[], chosen: ObjectNode[] | null) => void> = [];
  const nodes = options.nodes ?? [];
  const fake: FakeApi = {
    api: undefined as unknown as ModuleApi,
    bridge,
    commandRuns: [],
    commands: [],
    providers: [],
    logs: [],
    feedback: [],
    logged: [],
    pickStates: [],
    confirms: [],
    tagLists: [],
    rowLists: [],
    tagStore: new Map(Object.entries(options.tags ?? {})),
    dialogs: [],
    livePages: [],
    tracks: new Map(),
    volumes: new Map(),
    transactions: 0,
    fileStore: new Map(Object.entries(options.files ?? {})),
    unreadableFiles: new Set(),
    setId: options.setId ?? null,
    transport: options.transport ?? null,
    setLoopFails: options.setLoopFails ?? null,
    jumpFails: options.jumpFails ?? null,
    jumps: [],
    midiBindings: [],
    setListeners: [],
    midiBlocked: [],
    blockedListeners: [],
    eventListeners: [],
    midiStatusBar: false,
    mapEnabled: true,
    midiListens: [],
    settingGroups: [],
    settingValues: { ...(options.settings ?? {}) },
    completers: new Map(),
    unknownCompleters: () => unknownCompleterKeys(fake.commands, fake.completers.keys()),
  };
  fake.api = {
    bridge,
    liveSet: { nodes: () => nodes },
    tracks: {
      transaction: (fn) => {
        fake.transactions++;
        const pending = fn();
        return pending ? Promise.resolve(pending).then(() => undefined, () => undefined) : undefined;
      },
      volume: async (node) => (node.kind === "track" ? (fake.volumes.get(node.handleId) ?? 0.85) : null),
      setVolume: async (node, value) => {
        if (node.kind !== "track" || !Number.isFinite(value)) return false;
        fake.volumes.set(node.handleId, Math.min(1, Math.max(0, value)));
        return true;
      },
      track: (node) => {
        if (node.kind !== "track") return null; // like the real port: never the containing track
        let handle = fake.tracks.get(node.handleId);
        if (!handle && nodes.some((n) => n.handleId === node.handleId)) {
          handle = { mute: false, solo: false, arm: false };
          fake.tracks.set(node.handleId, handle);
        }
        return handle ?? null;
      },
    },
    set: {
      id: async (create) => {
        if (fake.setId === null && create === true) fake.setId = "fake-set-id";
        return fake.setId;
      },
      transport: async () => (fake.transport ? { ...fake.transport, loop: { ...fake.transport.loop } } : null),
      setLoop: async (loop: Loop) => {
        if (fake.setLoopFails) return { ok: false, code: fake.setLoopFails.code, text: fake.setLoopFails.text };
        if (!fake.transport) return { ok: false, code: 5, text: "the Remote Script is not running" };
        fake.transport.loop = { on: loop.on, start: loop.start, length: loop.length };
        return { ok: true, loop: { ...fake.transport.loop } };
      },
      // moves only `transport.time` (pos and barStart stay as they were)
      jump: async (time: number) => {
        fake.jumps.push(time);
        if (fake.jumpFails) return { ok: false, code: fake.jumpFails.code, text: fake.jumpFails.text };
        if (!fake.transport) return { ok: false, code: 5, text: "the Remote Script is not running" };
        fake.transport.time = time;
        return { ok: true, time };
      },
    },
    files: {
      readResult: async (name) => {
        if (!validFileName(name)) return { status: "failed", reason: "not a plain file name" };
        if (fake.unreadableFiles.has(name)) return { status: "failed", reason: "EACCES" };
        const text = fake.fileStore.get(name);
        return text === undefined ? { status: "missing" } : { status: "ok", text };
      },
      read: async (name) => (validFileName(name) && !fake.unreadableFiles.has(name) ? (fake.fileStore.get(name) ?? null) : null),
      write: async (name, text) => {
        if (!validFileName(name) || typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) return false;
        fake.fileStore.set(name, text);
        return true;
      },
    },
    settings: {
      gearAvailable: () => options.gearAvailable ?? false,
      declare: (group) => void fake.settingGroups.push(group),
      get: (async (name: string) => {
        const key = name.includes(".") ? name : `${fake.commands[0]?.name ?? "module"}.${name}`;
        const def = fake.settingGroups.flatMap((g) => g.items).find((d) => d.key === key);
        return key in fake.settingValues ? fake.settingValues[key] : def?.default;
      }) as ModuleApi["settings"]["get"],
    },
    onSetChange: (listener) => {
      fake.setListeners.push(listener);
      listener(fake.setId); // the fake's Set is known from the start
    },
    midi: {
      setBindings: async (list) => {
        const refused = list.flatMap((b) => {
          const problem = validateBinding(b.operator, b.line);
          return problem ? [`${formatControl(b.control)} ${b.operator}: ${problem}`] : [];
        });
        fake.midiBindings = list.filter((b) => validateBinding(b.operator, b.line) === null);
        return { ok: true, value: { count: fake.midiBindings.length, refused } };
      },
      last: async (since = 0) => {
        const messages = (options.midiMessages ?? []).filter((m) => m.seq > since);
        return { ok: true, value: { last: Math.max(since, ...messages.map((m) => m.seq)), messages } };
      },
      onEvent: (listener) => {
        fake.eventListeners.push(listener);
        return () => void fake.eventListeners.splice(fake.eventListeners.indexOf(listener) >>> 0, 1);
      },
      blocked: () => (fake.midiBlocked === null ? null : [...fake.midiBlocked]),
      onBlocked: (listener) => {
        fake.blockedListeners.push(listener);
        return () => void fake.blockedListeners.splice(fake.blockedListeners.indexOf(listener) >>> 0, 1);
      },
      statusBar: async () => fake.midiStatusBar,
      enabled: async () => fake.mapEnabled,
      setEnabled: async (on) => ((fake.mapEnabled = on), true),
      listen: async (controls, listenOptions) => {
        fake.midiListens.push({ controls, monitor: listenOptions?.monitor === true });
        return { ok: true, value: { count: controls === "all" ? 4112 : controls === "none" ? 0 : controls.length } };
      },
    },
    log: (line) => void fake.logs.push(line),
    logger: {
      debug: (text) => void fake.logged.push({ level: "debug", text }),
      info: (text) => void fake.logged.push({ level: "info", text }),
      warn: (text) => void fake.logged.push({ level: "warn", text }),
      error: (text) => void fake.logged.push({ level: "error", text }),
    },
    dialog: async (html, width, height, name, dialogOptions) => {
      fake.dialogs.push({ html, width, height, ...(name !== undefined ? { name } : {}), ...(dialogOptions?.gear !== undefined ? { gear: dialogOptions.gear } : {}) });
      return options.dialogAnswer || null;
    },
    commands: {
      add: (command) => void fake.commands.push(command),
      roots: () => fake.commands,
      help: (path) => helpForPath(fake.commands, path),
      usage: (path) => usageForPath(fake.commands, path),
      run: async (line, runOptions) => {
        fake.commandRuns.push({ line, ...(runOptions?.allow ? { allow: runOptions.allow } : {}) });
        return options.runResult?.(line) ?? ok();
      },
      completer: (key, source) => void (fake.completers.has(key) ? undefined : fake.completers.set(key, source)),
      defaults: () => ({ ...(options.defaults ?? {}) }),
    },
    pick: async (_title, candidates, multi = false, pickOptions) => {
      if (pickOptions?.state) fake.pickStates.push(pickOptions.state);
      const chosen = options.pickAnswer?.(candidates, multi) ?? null;
      for (const listener of pickListeners) listener(candidates, chosen);
      return chosen;
    },
    ui: {
      livePage: async (name, html, width, height, routes, pageOptions) => {
        fake.livePages.push({ name, html, width, height, routes, ...(pageOptions?.run ? { run: pageOptions.run } : {}), ...(pageOptions?.onClose ? { onClose: pageOptions.onClose } : {}) });
        return options.dialogAnswer || null;
      },
    },
    confirm: async (message) => {
      fake.confirms.push(message);
      return options.confirmAnswer ?? false;
    },
    pickRows: async (title, rows, listOptions) => {
      fake.rowLists.push({ title, rows, ...(listOptions?.cursor !== undefined ? { cursor: listOptions.cursor } : {}) });
      const index = options.pickRowsAnswer?.(rows, listOptions?.cursor) ?? null;
      return index !== null && rows[index] && !rows[index]!.disabled ? index : null;
    },
    pickTags: async (title, rows, listOptions) => {
      fake.tagLists.push({ title, rows, ...(listOptions?.allowNew ? { allowNew: true } : {}) });
      return options.pickTagsAnswer?.(rows) ?? null;
    },
    tags: {
      refresh: async () => ({ ok: true, value: undefined }),
      of: (node) => fake.tagStore.get(node.handleId) ?? [],
      write: async (node, tags) => {
        if (tags.length) fake.tagStore.set(node.handleId, [...tags]);
        else fake.tagStore.delete(node.handleId);
        return { ok: true, value: { name: node.name, tags: [...tags], marked: true } };
      },
    },
    onPick: (listener) => void pickListeners.push(listener),
    registerProvider: (provider) => void fake.providers.push(provider),
    onCommandRun: () => {},
    showFeedback: (message) => void fake.feedback.push(message),
  };
  return fake;
}
