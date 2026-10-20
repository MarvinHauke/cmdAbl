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
import type { PickPreview, StateChange } from "../core/ui.js";
import type { BridgeResult } from "../ableton/bridgeProtocol.js";
import type { TagsWritten } from "../ableton/bridgeOps.js";

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

/** One row of a tag list (`ModuleApi.pickTags`). */
export interface TagRow {
  /** Lower-case tag name, without the `#`. */
  name: string;
  /** How many tracks carry it (shown next to the name). */
  count?: number;
  /** The target has the tag: the row's state button is lit. Absent: no state button. */
  on?: boolean;
}

/** Track tags (plan 0008): stored in the Live Set by the Remote Script, read through a cache. Never throw. */
export interface TagsPort {
  /** Read the tags from the script now (awaited); fails with exit 5 when the script is not running. */
  refresh(): Promise<BridgeResult<void>>;
  /** The tags of a track as last read or written (empty: none known). Call `refresh` first when freshness matters. */
  of(node: ObjectNode): string[];
  /** Replace the track's whole tag list (empty removes the tags); the cache follows at once. Names must be normalised by the caller. */
  write(node: ObjectNode, tags: string[]): Promise<BridgeResult<TagsWritten>>;
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
  commands: {
    add(command: Command): void;
    /** The declared tree, read-only (for `man` and the like). Read the documentation fields only; never call a node's `run` from here — that would bypass parsing, resolution and the result presenter. */
    roots(): readonly Command[];
    /** The `--help` text of a command or subcommand by path (`["tag"]`, `["history", "clear"]`); undefined when unknown. */
    help(path: string[]): string | undefined;
  };
  /**
   * Show the pick list; resolves with the chosen objects, or null if cancelled.
   * `options.fill` (single-select only) lets Tab put the object into the
   * prompt instead of choosing it: the platform then ends the command without a
   * message and reopens the palette; the module sees a cancelled pick.
   */
  pick(
    title: string,
    candidates: ObjectNode[],
    multi?: boolean,
    options?: { fill?: boolean },
  ): Promise<ObjectNode[] | null>;
  /**
   * Ask a yes/no question: a single-select list titled `message` with two
   * rows, "Cancel" first and `confirmLabel` second, through the platform's dialog queue.
   * Resolves true only when `confirmLabel` was chosen; Cancel, Esc or a failing
   * dialog resolve false. "Cancel" is the first row, so a reflex Enter never acts.
   * Never rejects.
   */
  confirm(message: string, confirmLabel: string): Promise<boolean>;
  /**
   * The tag list (the same one the platform shows for a bare `#`): a
   * multi-select list of tags with their state buttons (`TagRow.on`), `options.change`
   * previewing what confirming does ("toggle" flips every marked row). Resolves with the
   * chosen tag names, or null when cancelled or nothing was marked.
   */
  pickTags(title: string, rows: TagRow[], options?: { change?: StateChange; preview?: PickPreview }): Promise<string[] | null>;
  /** Track tags (plan 0008). */
  tags: TagsPort;
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
   * full canonical invocation string (e.g. "mute --set 0 bass, lead").
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
