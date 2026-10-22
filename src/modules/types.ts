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
import type { BoardAnswer, BoardRequest, PickPreview, StateChange } from "../core/ui.js";
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
   * One transaction = one undo step for everything `fn` writes. `fn` itself must be
   * synchronous (an async callback would write outside the transaction), but it may RETURN a
   * promise — `Promise.all([api.tracks.setVolume(a, 0.5), …])` — to group async writes into the
   * step. A write can throw — it is the SDK track — so catch inside `fn`: nothing may throw at
   * a user action. With a returned promise the call answers a promise that never rejects
   * (resolves when the writes are done); with a plain `void` fn it answers at once.
   */
  transaction(fn: () => void | Promise<unknown>): Promise<void> | void;
  /**
   * The track at the node's position, or null when there is none or the node
   * is not a track (a device, chain or pad never answers with its containing
   * track). After a Set change that position may hold another track: check the
   * name when it matters.
   */
  track(node: ObjectNode): TrackHandle | null;
  /**
   * The track's volume as 0..1 (`mixer.volume`; 0.85 is 0 dB), for regular, return, group and main
   * tracks; null when the node is no track or the read fails. Not a dB value: the curve is Live's own.
   */
  volume(node: ObjectNode): Promise<number | null>;
  /**
   * Set the track's volume, 0..1 (clamped). The write starts at once, so inside `transaction(() =>
   * setVolume(…))` it joins that undo step. Resolves true when written, false for no track, a
   * non-finite value or a failed write; never rejects.
   */
  setVolume(node: ObjectNode, value: number): Promise<boolean>;
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

/** The Live Set's own identity (plan 0013). */
export interface SetPort {
  /**
   * The id stored in the Set (`cmdabl.set-id`, kept with Song.set_data; it survives save, reload, Save As and
   * Collect All and Save (Live-tested 2026-10-22), so it can name things that belong to this Set).
   * `create: true` stores a new random id when the Set has none.
   * Null: the Set has no id yet (and `create` was not given), or the Remote Script is not running
   * or too old. Never throws.
   */
  id(create?: boolean): Promise<string | null>;
}

/** A module's own small text files in the extension's data folder (plan 0013). */
export interface FilesPort {
  /**
   * The text of the file, or null when it does not exist, the name is refused or the read fails.
   * Names are plain file names (no "/" or "\\" or "..", no leading dot, at most 100 characters); a
   * module sees only its own folder `<data folder>/modules/<module name>/`.
   */
  read(name: string): Promise<string | null>;
  /**
   * Write the file (UTF-8, at most 1 MB), creating the folder on the first write; the file appears
   * whole or not at all. True when written, false for a refused name, too much text or a failing
   * disk (a warning is logged). Never throws.
   */
  write(name: string, text: string): Promise<boolean>;
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
  /** The Set's identity (plan 0013). */
  set: SetPort;
  /** The module's own files (plan 0013). */
  files: FilesPort;
  /** One info line in the log, tagged with the module's name (`cmdAbl [name] info: …`); no prefix of your own. */
  log(line: string): void;
  /**
   * Leveled log lines tagged with the module's name (plan 0011). `debug` lines exist only after
   * `cmdabl log --debug`. The last 500 lines are shown by `cmdabl log`. Never log a token, a
   * secret or an environment value. Prefer `CommandResult.log` for what a command changed.
   */
  logger: { debug(text: string): void; info(text: string): void; warn(text: string): void; error(text: string): void };
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
    /** Exactly what `<command> --help` prints (usage, sections, and `more: man …` when `man` exists); undefined when unknown. For a handler that answers exit 2 with the usage. */
    usage(path: string[]): string | undefined;
  };
  /**
   * Show the pick list; resolves with the chosen objects, or null if cancelled.
   * `options.fill` (single-select only) lets Tab put the object into the
   * prompt instead of choosing it: the platform then ends the command without a
   * message and reopens the palette; the module sees a cancelled pick.
   * `options.state` gives each candidate (in order) a state button — `values[i]` true = on,
   * false = off, null = unknown (a missing entry counts as unknown) — named once by `label` ("tagged fx"); `change` previews what
   * confirming does ("toggle" flips each marked row, "on"/"off" sets it).
   */
  pick(
    title: string,
    candidates: ObjectNode[],
    multi?: boolean,
    options?: { fill?: boolean; state?: { label: string; values: Array<boolean | null>; change?: StateChange } },
  ): Promise<ObjectNode[] | null>;
  /**
   * The board editor (plan 0010): sections whose items are on or off. Resolves when the page
   * closes with `answer` = the changes and new section names core validated against the request
   * (unknown ids, readonly sections, no-ops and names not matching `create.pattern` are already
   * dropped), or null when closed. `cut` says the request was capped (40 sections × 200 items ×
   * 300 characters) or had entries dropped, so the module can say "list cut". Nothing is applied
   * by the page: write the changes, then show a new board if wanted. Section and item ids must be at most 300 characters (longer ones are dropped, `cut` is true); `create.pattern` is used as given.
   */
  ui: { board(request: BoardRequest): Promise<{ answer: BoardAnswer | null; cut: boolean }> };
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
   * chosen tag names, or null when cancelled or nothing was marked. With `allowNew` the list
   * offers a create row for the filter text; choosing it adds that text (trimmed, as typed, NOT
   * validated — the module checks it) as the last name, next to the rows marked.
   * With `multi: false` (default true) the list is single-select: Enter picks the cursor row, there are
   * no marks and no state buttons (`on` and `change` are ignored); the create row still works. The result
   * holds exactly one name.
   */
  pickTags(title: string, rows: TagRow[], options?: { change?: StateChange; preview?: PickPreview; allowNew?: boolean; multi?: boolean }): Promise<string[] | null>;
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
  /** The name log lines carry (`cmdAbl [name] …`); default: the module's first command. */
  name?: string;
  activate(api: ModuleApi): void;
}
