import type { ObjectNode } from "../ableton/objectTree.js";
import { createFakeBridge, type FakeBridge, type FakeBridgeOptions } from "../ableton/bridgeFake.js";
import type { Command } from "../commandRegistry.js";
import type { Provider } from "../types.js";
import type { ModuleApi, TrackHandle } from "./types.js";

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
}

export interface FakeApi {
  api: ModuleApi;
  bridge: FakeBridge;
  /** Commands the module declared, in order. */
  commands: Command[];
  providers: Provider[];
  logs: string[];
  feedback: string[];
  dialogs: Array<{ html: string; width: number; height: number }>;
  /** Track state by handle id; writes land here. */
  tracks: Map<string, TrackHandle>;
  /** How many transactions were opened. */
  transactions: number;
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
    dialogs: [],
    tracks: new Map(),
    transactions: 0,
  };
  fake.api = {
    bridge,
    liveSet: { nodes: () => nodes },
    tracks: {
      transaction: (fn) => {
        fake.transactions++;
        fn();
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
    log: (line) => void fake.logs.push(line),
    dialog: async (html, width, height) => {
      fake.dialogs.push({ html, width, height });
      return options.dialogAnswer || null;
    },
    commands: { add: (command) => void fake.commands.push(command) },
    pick: async (_title, candidates, multi = false) => {
      const chosen = options.pickAnswer?.(candidates, multi) ?? null;
      for (const listener of pickListeners) listener(candidates, chosen);
      return chosen;
    },
    onPick: (listener) => void pickListeners.push(listener),
    registerProvider: (provider) => void fake.providers.push(provider),
    onCommandRun: () => {},
    showFeedback: (message) => void fake.feedback.push(message),
  };
  return fake;
}
