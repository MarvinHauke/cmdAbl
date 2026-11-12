// The surface cmdAbl's bundled default modules (goto, mute, solo, pakabl, …)
// declare commands through — a thin facade over the same command tree/Provider
// platform third-party `cmdabl`-declaring extensions will eventually reach
// through executeCommand (see docs/feature-plans/0003-pakabl-extension-system.md).
// A module declares commands as tree nodes (`commands.add`, docs/feature-plans/0005);
// there is no other registration path.

import type { Command } from "../core/command/commandRegistry.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import type { Bridge } from "../ableton/bridgeClient.js";
import type { Provider } from "../core/types.js";
import type { Completer } from "../core/complete/complete.js";
import type { LiveRoutes } from "../core/surfaces/livePage.js";
export type { LiveRoutes } from "../core/surfaces/livePage.js";
import type { ReadResult } from "../core/settings/files.js";
export type { ReadResult } from "../core/settings/files.js";
export type { Candidate, Completer, CompleterContext } from "../core/complete/complete.js";
import type { MidiPort } from "../core/midi/midiPort.js";
export type { BindingsSet, ListenOptions, MidiPort } from "../core/midi/midiPort.js";
export type { MidiBinding } from "../core/midi/midiEngine.js";
export type { MidiControl, MidiMessage, OperatorName } from "../core/midi/midi.js";
import type { BoardAnswer, BoardRequest, PickPreview, StateChange } from "../core/surfaces/ui.js";
import type { SettingDef } from "../core/settings/settings.js";
export type { SettingDef } from "../core/settings/settings.js";
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

/** One row of a plain list (`ModuleApi.pickRows`). */
export interface PickRow {
  label: string;
  detail?: string;
  disabled?: boolean;
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
  /**
   * The transport (plan 0013, stamps): playing state, whether a session clip plays, the position `pos` ("12.3.1.1"),
   * the time and the current bar's start and length, and the arrangement loop; all times in beats.
   * Null: the Remote Script is not running or too old, or the read failed. Never throws.
   */
  transport(): Promise<Transport | null>;
  /**
   * Set the arrangement loop (on/off, start, length in beats). Resolves to the loop as Live has it afterwards, or a
   * failure with the exit code (1 Live refused the value, 5 no script or an old one) and a text. Never throws.
   */
  setLoop(loop: Loop): Promise<SetLoopResult>;
  /**
   * Move the playhead to `time` beats (playing stays playing). Resolves to the position as Live has it afterwards
   * (`note` words a difference from the target, for the debug log; never an error), or a failure with the exit code
   * (1 Live refused or did not answer, 5 no script or an old one) and a text. Never throws.
   */
  jump(time: number): Promise<JumpResult>;
}

/** The answer of `SetPort.jump`. */
export type JumpResult = { ok: true; time: number; note?: string } | { ok: false; code: 1 | 5; text: string };

/** The answer of `SetPort.setLoop`. */
export type SetLoopResult = { ok: true; loop: Loop } | { ok: false; code: 1 | 5; text: string };

/** The arrangement loop, in beats. */
export interface Loop {
  on: boolean;
  start: number;
  length: number;
}

/** The transport as the Remote Script reports it (plan 0013). Times are in beats. */
export interface Transport {
  playing: boolean;
  /** Any track plays a session clip. */
  session: boolean;
  /** The position as "bar.beat.sixteenth.tick", e.g. "12.3.1.1". */
  pos: string;
  time: number;
  barStart: number;
  barLen: number;
  /** The current time signature (0 = unknown: an old script did not say; do not guess a bar length from it). */
  sigNum: number;
  sigDen: number;
  /** The length of the Set (Song.song_length), in beats. */
  songLength: number;
  loop: Loop;
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
   * Like `read`, but tells "no such file" from "the read failed": `{ status: "ok", text }`, `{ status: "missing" }`
   * (the file does not exist: safe to start empty), or `{ status: "failed", reason }` (a refused name, a folder with
   * that name, no permission, …: do NOT write over it). `reason` is a short code, never content. Never throws.
   */
  readResult(name: string): Promise<ReadResult>;
  /**
   * Write the file (UTF-8, at most 1 MB), creating the folder on the first write; the file appears
   * whole or not at all. True when written, false for a refused name, too much text or a failing
   * disk (a warning is logged). Never throws.
   */
  write(name: string, text: string): Promise<boolean>;
}

/** Declared settings (plan 0019): the settings page is generated from what modules declare here. */
export interface SettingsPort {
  /**
   * Declare this module's settings, once, at activation. The group is shown on the Settings page under `heading`, and
   * `<module> config` (e.g. `tag config`) opens just that group. Every key must be `<module>.<name>` (the module's
   * `name`, else its first command; declare after `name` is set or after the first `commands.add`); a key outside that
   * namespace, a bad declaration or a key declared twice is a warning in the log and that item is dropped. Kinds: `bool`,
   * `enum` (`choices: [{ value, label }]`) and `int` (`min`…`max`); the default must fit its kind. Modules never write
   * settings: only the Settings page does. Never throws.
   */
  declare(group: { heading: string; items: SettingDef[] }): void;
  /**
   * The current value of one of this module's settings, `name` being the full key (`tag.foldAfter`) or just the part
   * after the module's name (`foldAfter`). The declared default when the file has no value or a wrong one; read the
   * file again whenever it changed, so a new value applies at the next run. `undefined` for a key nobody declared.
   * Never throws.
   */
  get<T = unknown>(name: string): Promise<T>;
  /**
   * Whether the gear of a module page works in the run that is going now (plan 0010 "Build"): true while a palette line of
   * a command with declared settings runs, false in map bindings, page runs, `;` chains
   * and headless runs. A page that draws a gear (`gear: true` on `dialog` / `livePage`) hides it when this is false.
   * Never throws.
   */
  gearAvailable(): boolean;
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
  /** The module's declared settings (plan 0019). */
  settings: SettingsPort;
  /**
   * Be told when the Live Set is (re)available or has changed: `listener` gets the Set's id (plan 0013; null = the
   * Set has none yet) once the Remote Script answers for the first time (also after it came up later than the
   * extension), at once when it is already known, and again whenever the id differs (a new Set was opened).
   * A different Set without an id is not told apart from the previous one without an id. A throwing listener is skipped.
   */
  onSetChange(listener: (setId: string | null) => void): void;
  /** MIDI mapping (plan 0018): the bindings the engine runs, what the script forwards, the messages it kept. */
  midi: MidiPort;
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
   *
   * `options.gear` (plan 0019, 0010 "Build"): the page draws a settings gear and answers `{"settings": true}` when it is
   * pressed. Core then opens `<module> config` and runs the command line again (the same rules as the board's gear: the
   * WHOLE line runs again, so only a command that reads first and writes after the page closed may use it). The module sees
   * only a closed page (null). The flag counts only while a command with declared settings runs; otherwise it is ignored and
   * the answer comes back as a plain string. Also on `ui.livePage` through its options.
   */
  dialog(html: string, width: number, height: number, name?: string, options?: { gear?: boolean }): Promise<string | null>;
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
    /**
     * Register a source of completion candidates under `key`; commands name it in `ArgDef.complete`
     * or `OptionDef.complete` (`tag --rename` -> the Set's tags). The palette calls it ONCE when it
     * opens (the context has no `tokens` then) and filters the rows while the user types.
     * Return strings or `{ label, insert?, description? }`, synchronously or as a promise.
     * A completer is read-only: no writes, no dialogs, no bridge call of its own: read a cache
     * (refresh bridge-backed caches in a hook that runs at open, not here). It gets about 100 ms; a throw or
     * a timeout gives no rows (and a debug line in the log). A key nobody registered is a
     * warning at activation. Never throws at the caller.
     */
    completer(key: string, source: Completer): void;
    /**
     * The usable default commands (plan 0019 §7), `command → line` (what a bare `mute` runs), the same data as
     * `CompletionData.defaults`. Read-only and synchronous: it reflects the last load of the defaults file, which the
     * platform refreshes at every run and every palette open (so call it from a handler or completer, not at activation,
     * when it can still be empty). For display only (e.g. `map -l`); expansion is the platform's.
     */
    defaults(): Readonly<Record<string, string>>;
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
   * by the page: write the changes, then show a new board if wanted. A section flagged `renamable` / `removable` gets a rename / remove
   * action on its heading; the answer then also carries `renamed: [{ section, to }]` (a new name that matches `create.pattern`; an
   * existing name means merge: the module decides) and `removed: [section]` (the whole section; wins over a rename of it). Both are
   * absent when empty. Removing a whole section is destructive: confirm with `api.confirm` after the board closes, before writing. Section and item ids must be at most 300 characters (longer ones are dropped, `cut` is true); `create.pattern` is used as given.
   */
  ui: {
    board(request: BoardRequest): Promise<{ answer: BoardAnswer | null; cut: boolean }>;
    /**
     * A page of the module's own that may READ from the module while it is open (the read-only exception to the dialog
     * rule, plan 0018 "Live pages"): like `dialog`, but `routes` are served to the page under a one-time token, e.g.
     * `{ messages: () => rows }` at `GET <LIVE.base>/messages` with `Authorization: Bearer <LIVE.token>`. The page has
     * `const LIVE = /*LIVE_PLACEHOLDER*\/null;` and gets `{ base, token }` there; it polls (about every 100 ms) and never
     * writes. A route function must be read-only and quick (about 100 ms, else the page gets `{ error }`), and returns
     * plain JSON data (at most 256 KB); a throw gives `{ error }`. The routes and the token end with the dialog.
     * A route may also WAIT (long polling): `{ wait: (since, cancel) => Promise<data> }`. The server holds the request
     * (`GET <base>/<route>?since=<n>`, the page's last seen number; `since` is null when the page sent none, its first request: answer at once) until `wait` resolves with data
     * newer than `since`, or 1000 ms pass (then `{ timeout: true }`); a newer request replaces a held one
     * (`{ replaced: true }`), and the dialog closing answers `{ error: "closed" }`. `cancel.onCancel(cb)` runs once when the
     * wait ends for any reason (answered, timeout, replaced, client gone, closed): drop your listeners there.
     * Without the server (port taken) the page opens as a data page with `LIVE = null`: it must work without polling.
     * `options.run` (plan 0018 "Page runs") lets the page RUN command lines while open: the command paths it may run
     * (command plus subcommands, e.g. `["loop here", "loop back"]`; options and arguments are free). The page posts
     * `POST <LIVE.base>/run` with JSON `{ line }` and the same `Authorization: Bearer <LIVE.token>`, and gets
     * `{ code, text }` (the `CommandResult`'s exit code and message). A line whose command path is not listed (also a `;`
     * chain with any unlisted part, or a bare `|`) is refused with `{ code: 2, text }` and a warn line. An allowed line runs
     * through the normal path, nested while this call still waits: headless (no dialogs, exit 4 where it would ask), one
     * undo step, logged, errors caught, NOT added to the history. Not available without the server (`LIVE = null`): fall back
     * to closing the page (`then`) and reopening it.
     * `options.onClose` (plan 0026 "Safety net") is one command line core runs once after the page has closed and its
     * in-flight page runs have finished, but only if the page made at least one page run (a refused one counts; so not for a plain read, a data page, or
     * a close without runs); then whatever the page answered, also a dismiss (e.g. `"loop back"`). Same rules
     * as a page run: its command path must be listed in `run` (else refused with a warn line), headless, logged, errors
     * caught, NOT in the history, no dialogs. Its result is only logged.
     * Resolves with the string the page returns on close, or null if dismissed, like `dialog`.
     */
    livePage(name: string, html: string, width: number, height: number, routes: LiveRoutes, options?: { run?: string[]; onClose?: string; gear?: boolean }): Promise<string | null>;
  };
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
  /**
   * A single-select list of plain rows (plan 0027; not objects, not tags): Enter chooses the cursor row. Resolves with
   * the chosen row's index, or null when cancelled. `cursor` is the row that has the cursor on opening; a `disabled` row
   * is shown but cannot be chosen and the cursor skips it. Same dialog queue, list keys and headless rule as `pick`
   * (headless it would ask, so the run ends with exit 4). Never rejects.
   */
  pickRows(title: string, rows: PickRow[], options?: { cursor?: number }): Promise<number | null>;
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
   *
   * `typed` (additive, plan 0019 §7) is the line as the user typed it, given only when a default command
   * replaced a bare word: `invocation` is what ran ("mute #drums"), `typed` is "mute".
   */
  onCommandRun(listener: (invocation: string, typed?: string) => void): void;
  /** Show a small modal with a message and a "Close" button. */
  showFeedback(message: string): void;
}

export interface Module {
  /** The name log lines carry (`cmdAbl [name] …`); default: the module's first command. */
  name?: string;
  activate(api: ModuleApi): void;
}
