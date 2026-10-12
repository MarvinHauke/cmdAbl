// The surface cmdAbl's bundled default modules (goto, mute, solo, pakabl, …)
// declare commands through — a thin facade over the same command tree/Provider
// platform third-party `cmdabl`-declaring extensions will eventually reach
// through executeCommand (see docs/feature-plans/0003-pakabl-extension-system.md).
// A module declares commands as tree nodes (`commands.add`, docs/feature-plans/0005);
// there is no other registration path.

import type { Command } from "../core/commandRegistry.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import type { Bridge } from "../ableton/bridgeClient.js";
import type { Provider } from "../core/types.js";

/** What a track write needs: the three booleans of an SDK track. */
export interface TrackHandle {
  mute: boolean;
  solo: boolean;
  arm: boolean;
}

/** The SDK-backed track port — works without the Remote Script. */
export interface TracksPort {
  /**
   * One transaction = one undo step for everything `fn` writes. `fn` must be
   * synchronous (an async callback would write outside the transaction). A
   * write can throw — it is the SDK track — so catch inside `fn`: nothing may
   * throw at a user action.
   */
  transaction(fn: () => void): void;
  /**
   * The track at the node's position, or null when there is none or the node
   * is not a track (a device, chain or pad never answers with its containing
   * track). After a Set change that position may hold another track: check the
   * name when it matters.
   */
  track(node: ObjectNode): TrackHandle | null;
}

export interface LiveSetPort {
  /** The addressable objects of the current Set, flattened (tracks, devices, chains), with unique-able paths. */
  nodes(): ObjectNode[];
}

export interface ModuleApi {
  /** The Remote Script bridge (never throws; see ableton/bridgeClient.ts). Tests pass a fake. */
  readonly bridge: Bridge;
  /** The current Live Set as an object tree. */
  liveSet: LiveSetPort;
  /** Track writes through the SDK. */
  tracks: TracksPort;
  /** One log line (the platform owns the sink; modules write their own "cmdAbl: …" prefix). */
  log(line: string): void;
  /**
   * Show a page of the module's own in a modal dialog; resolves with the one
   * string the page returns when it closes, or null if it was dismissed. Goes
   * through the platform's dialog queue like every other dialog. An empty
   * string counts as dismissed. `name` appears in the queue's log lines.
   */
  dialog(html: string, width: number, height: number, name?: string): Promise<string | null>;
  /**
   * Declare a command. The platform parses the line, resolves `path`
   * arguments to Live objects (asking the user to pick when ambiguous) and
   * only then calls `run` — see docs/feature-plans/0005.
   */
  commands: { add(command: Command): void };
  /** Show the pick list; resolves with the chosen objects, or null if cancelled. */
  pick(title: string, candidates: ObjectNode[], multi?: boolean): Promise<ObjectNode[] | null>;
  /** Notified whenever a pick list was shown, with what was offered and what was chosen. */
  onPick(listener: (candidates: ObjectNode[], chosen: ObjectNode[] | null) => void): void;
  /**
   * Contribute searchable items to the palette snapshot. Lower `priority` sorts
   * earlier in the empty-query list (default 0; commands are 0, history is
   * negative so recent invocations come first). Ties keep registration order.
   */
  registerProvider(provider: Provider, priority?: number): void;
  /**
   * Notified after any command finishes with code 0 — fresh or re-run — with its
   * full canonical invocation string (e.g. "mute /vermona/kick, /vermona/snare").
   * Failed runs are not reported, and neither are bare invocations with no
   * arguments. The only window a module gets into *every* command run
   * regardless of who registered it.
   */
  onCommandRun(listener: (invocation: string) => void): void;
  /** Show a small modal with a message and a "Close" button. */
  showFeedback(message: string): void;
}

export interface Module {
  activate(api: ModuleApi): void;
}
