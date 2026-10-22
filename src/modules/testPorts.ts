import type { ObjectNode } from "../ableton/objectTree.js";
import { createFakeBridge, type FakeBridge, type FakeBridgeOptions } from "../ableton/bridgeFake.js";
import type { Command } from "../core/commandRegistry.js";
import { helpForPath, unknownCompleterKeys, usageForPath } from "../core/commandTree.js";
import type { Completer } from "../core/complete.js";
import type { Provider } from "../core/types.js";
import type { BoardAnswer, BoardRequest, StateChange } from "../core/ui.js";
import { MAX_FILE_BYTES, validFileName } from "../core/files.js";
import type { ModuleApi, TagRow, TrackHandle } from "./types.js";

// A ModuleApi made of fakes, so a module's `activate` and its commands' `run`
// can be tested without Live: an in-memory bridge, a scripted object tree,
// recorded track writes, log lines and dialogs. Used by module tests only.

export interface FakeApiOptions {
  nodes?: ObjectNode[];
  bridge?: FakeBridgeOptions;
  /** What the dialog answers (the string a page returns on close); null or empty = dismissed. */
  dialogAnswer?: string | null;
  /** What `api.pick` answers (default: cancelled). Registered `onPick` listeners are notified like the platform does. */
  pickAnswer?: (candidates: ObjectNode[], multi: boolean) => ObjectNode[] | null;
  /** What `api.ui.board` answers (default: closed). The request is recorded in `fake.boards`. */
  boardAnswer?: (request: BoardRequest) => BoardAnswer | null;
  /** What `api.confirm` answers (default: false, i.e. cancelled). */
  confirmAnswer?: boolean;
  /** What `api.pickTags` answers (default: cancelled). */
  pickTagsAnswer?: (rows: TagRow[]) => string[] | null;
  /** Tags per node (by `handleId`) the fake `api.tags` starts with; writes land in `fake.tagStore`. */
  tags?: Record<string, string[]>;
  /** The Set's id the fake `api.set.id` starts with (default: none yet; `id(true)` then makes "fake-set-id"). */
  setId?: string | null;
  /** Files the fake `api.files` starts with, by name. */
  files?: Record<string, string>;
}

export interface FakeApi {
  api: ModuleApi;
  bridge: FakeBridge;
  /** Commands the module declared, in order. */
  commands: Command[];
  providers: Provider[];
  logs: string[];
  feedback: string[];
  /** The boards `api.ui.board` was asked to show. */
  boards: BoardRequest[];
  /** The `state` options `api.pick` was given, in order. */
  pickStates: Array<{ label: string; values: Array<boolean | null>; change?: StateChange }>;
  /** Every line written through `api.logger`, with its level (`api.log` lines are in `logs` as well). */
  logged: Array<{ level: "debug" | "info" | "warn" | "error"; text: string }>;
  /** The messages `api.confirm` was asked. */
  confirms: string[];
  /** The tag lists `api.pickTags` showed (title and rows). */
  tagLists: Array<{ title: string; rows: TagRow[]; allowNew?: boolean }>;
  /** Tags by node `handleId`; `api.tags.write` replaces the entry (empty removes it). */
  tagStore: Map<string, string[]>;
  dialogs: Array<{ html: string; width: number; height: number }>;
  /** Track state by handle id; writes land here. */
  tracks: Map<string, TrackHandle>;
  /** Volumes (0..1) written through the fake's `tracks.setVolume`, by handle id; unset reads 0.85. */
  volumes: Map<string, number>;
  /** How many transactions were opened. */
  transactions: number;
  /** The fake `api.files`, by name; writes land here. */
  fileStore: Map<string, string>;
  /** The Set's id now (`api.set.id(true)` fills it when empty). */
  setId: string | null;
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
    commands: [],
    providers: [],
    logs: [],
    feedback: [],
    logged: [],
    boards: [],
    pickStates: [],
    confirms: [],
    tagLists: [],
    tagStore: new Map(Object.entries(options.tags ?? {})),
    dialogs: [],
    tracks: new Map(),
    volumes: new Map(),
    transactions: 0,
    fileStore: new Map(Object.entries(options.files ?? {})),
    setId: options.setId ?? null,
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
    },
    files: {
      read: async (name) => (validFileName(name) ? (fake.fileStore.get(name) ?? null) : null),
      write: async (name, text) => {
        if (!validFileName(name) || typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) return false;
        fake.fileStore.set(name, text);
        return true;
      },
    },
    log: (line) => void fake.logs.push(line),
    logger: {
      debug: (text) => void fake.logged.push({ level: "debug", text }),
      info: (text) => void fake.logged.push({ level: "info", text }),
      warn: (text) => void fake.logged.push({ level: "warn", text }),
      error: (text) => void fake.logged.push({ level: "error", text }),
    },
    dialog: async (html, width, height) => {
      fake.dialogs.push({ html, width, height });
      return options.dialogAnswer || null;
    },
    commands: {
      add: (command) => void fake.commands.push(command),
      roots: () => fake.commands,
      help: (path) => helpForPath(fake.commands, path),
      usage: (path) => usageForPath(fake.commands, path),
      completer: (key, source) => void (fake.completers.has(key) ? undefined : fake.completers.set(key, source)),
    },
    pick: async (_title, candidates, multi = false, pickOptions) => {
      if (pickOptions?.state) fake.pickStates.push(pickOptions.state);
      const chosen = options.pickAnswer?.(candidates, multi) ?? null;
      for (const listener of pickListeners) listener(candidates, chosen);
      return chosen;
    },
    ui: {
      board: async (request) => {
        fake.boards.push(request);
        return { answer: options.boardAnswer?.(request) ?? null, cut: false };
      },
    },
    confirm: async (message) => {
      fake.confirms.push(message);
      return options.confirmAnswer ?? false;
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
