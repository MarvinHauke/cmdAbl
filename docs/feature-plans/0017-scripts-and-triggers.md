# Scripts and triggers: `.cmdabl` files, run from clips and scenes

**Status:** `;` chains released in 0.1.5 (2026-11-05, PR #27). Phase 1 (script files, `run`) is next;
the push channel phase 2 needs exists since 0018 (UDP from the Remote Script). Trigger: run command
scripts from clips and scenes, so Live's Session grid works as a grid of commands.

**Parent:** [0004](0004-command-platform.md)
**Related:**
- [0009](0009-ideas-from-clyphx.md): triggers, `;` action lists;
- [0008](0008-tags-and-aliases.md): aliases;
- [0016](0016-test-mcp.md): the dialog-free runner;
- [0011](0011-logging.md): logging.

## Context

- cmdAbl runs one command line at a time from the palette.
- [0016](0016-test-mcp.md) added a dialog-free runner (`runHeadless`) that runs a line with no dialog:
  an ambiguous address gives exit 4, and a question counts as cancelled.
- The Remote Script sees Live's events (clip playing status, scene triggered), but the bridge only goes
  cmdAbl → script.
- In Live's Session view, tracks are columns, scenes are rows, and every clip slot is a cell. If a
  launch can run a script, the grid becomes a grid of commands, with launch quantization, follow
  actions, Launchpad control and the visual layout coming from Live.

**Done means:**
- `drop.cmdabl` in cmdAbl's scripts folder runs from the palette;
- a clip or scene whose name names the script runs it when it launches.

## `;` chains (user, 2026-10-23; released in 0.1.5)

`mute #drums; vol -6 #bass` runs both commands in one line. This comes before script files, which reuse
it.

- **Splitting:** core splits on `;` outside quotes (`";"` stays text).
  - A word ending in `;` splits too: `mute /Kick; solo /Bass` is the same as `mute /Kick ; solo /Bass`.
  - Empty parts and a trailing `;` are ignored.
- **Order and failures:** the parts run in order. Like `;` in a shell, a failing part does not stop the
  rest; stopping on failure is `&&`, later.
- **Result:**
  - all parts ok: quiet, with one log line per part;
  - with a failure: the ✓/× dialog lists each part with its result;
  - the exit code is the first failing part's code, or 0.
- **Pick lists:**
  - in the palette, an ambiguous part asks as usual, in turn;
  - cancelling a pick stops the chain, and the parts before it stay done;
  - headless (scripts, MCP, triggers): exit 4 for that part.
- **Undo:** one Cmd+Z per part, not per line. The SDK's `withinTransaction` callback must be synchronous
  (`docs/sdk-tree.md`), and parts wait for target resolution, pick lists and the bridge, so one
  transaction can't span them (core `cfe1e4f`).
- **Behaviour change** (release notes): an unquoted `;` splits everywhere, also in free-text arguments
  (`find a;b` is two commands). Old history entries with `;` replay as chains. Wording: "`;` separates
  commands; quote it to search for it".
- **History:** stores the whole line, each part with its unique paths (as single commands are stored
  today).
- **Completion:** after `; ` completion starts again at the command name. The hint panel and the usage
  belong to the part the caret is in.
- **Errors in the parser** name the part: `part 2 (vol -6 #bass): …`.

## Phase 1: script files (no protocol change)

- **Where:** `<data folder>/scripts/<name>.cmdabl`. Plain UTF-8 text, one command line per line,
  `#` starts a comment, empty lines are ignored.
- **Running:**
  - `run <name>` runs the script, with the name completed from the folder;
  - `run --list` lists the scripts;
  - `run --edit <name>` opens the file in the note page's editor, reusing `ui/modules/note/note.html` in
    plain-text mode.
- **Execution:**
  - lines run in order through the dialog-free runner;
  - the first line with an exit code other than 0 stops the script, and the message names the line
    number and the reason;
  - one Cmd+Z undoes the whole script, if the SDK allows one transaction across lines (spike);
    otherwise one step per line, documented.
- **Safety:**
  - no dialogs: `--pick` and ambiguous words fail, so scripts use exact paths and tags;
  - a script may `run` another script, at most 8 deep, and never itself (a loop guard);
  - a script stops after about 5 s in total.
- **Logging:** one `info` line per script with its result, and the lines it ran at `debug`.
- **Completion:** `run ` offers the script names with their first comment line as the description.
- **Module:** `run` is a module (`src/modules/run/`). The scripts folder uses `api.files`, or a small
  core helper if `api.files` stays per-module.

## Phase 2: triggers from clips and scenes (needs the bridge addition)

- **Names:**
  - a clip or scene runs a script when its name contains `[> name]`, e.g. a scene called
    `Drop [> drop]`;
  - inline lines may follow as `[> mute #drums; vol -6 #bass]` once `;` exists ([0009](0009-ideas-from-clyphx.md));
  - the rest of the name stays as Live shows it.
- **Events (Remote Script):**
  - a Session clip starts playing (on the real start after launch quantization, not on the trigger);
  - a scene is triggered;
  - later: Arrangement clips, and locators being passed.
- **The bridge addition (approved 2026-11-03 with [0018](0018-midi-mapping.md), spike first):** the script pushes `{event, track, scene, name}` to cmdAbl, which
  finds the `[> …]` part and runs it. Options for the push:
  - an unsolicited UDP datagram to the extension's bridge socket;
  - an HTTP POST to the local trigger server, with the access token.

  A spike decides, measuring latency with 8 tracks.
- **A setting, off by default:** `triggers.enabled` in `settings.json`. While off, launches never run
  anything.
- **Behaviour during playback:**
  - a trigger run is not added to the history;
  - undo: at most one step per launch; whether trigger runs should write undo steps at all is decided
    by the spike;
  - nothing ever opens a dialog: failures go to the log, and at most one quiet notice per launch;
  - a trigger may not launch clips or scenes that trigger again within the same run (a loop guard).
- **Timing:** about 50–100 ms after the real start. Good for mutes, levels, tags and notes; not for
  sample-accurate actions.

## Phase 3 and later

- `;` action lists and user aliases: [0009](0009-ideas-from-clyphx.md), [0008](0008-tags-and-aliases.md).
- `&&` and `||` on exit codes; `$1` and `$@` parameters for scripts and aliases.
- **Idea (user, 2026-11-11): command substitution and a `math` module.** One command's output inside
  another (`find --at $(math random 1 8)`), for every command, in the platform; `math` is one source of
  values. Later, with the rest of phase 3. Example with a real output → input: `loop at $(note stamp prev)`
  loops the section of the previous stamp (0026). Not for "while" cases (loop while writing): those are
  page runs and `;` chains.
- Named values, conditions on Live state, waiting in musical time: each with its own plan.

## What a complete scripting engine still needs (2026-10-23)

| Piece | What it is | State |
|---|---|---|
| `;` chains | several commands in one line, run in order | released in 0.1.5 |
| Script files | `.cmdabl`, `run <name>` | phase 1 |
| Triggers | clips and scenes run scripts on launch | phase 2, bridge addition undecided |
| Aliases | saved lines under a name | [0008](0008-tags-and-aliases.md); the store exists |
| `&&` / `\|\|` | run the next part only on success or failure (exit codes) | exit codes exist; operators missing |
| Parameters | `$1`, `$@` in scripts and aliases | missing |
| Relative targets | "this clip's track", the selected track (`.`), index and range | idea in [0009](0009-ideas-from-clyphx.md) |
| Variables | named values (`$drop = -6`), maybe controls from [0015](0015-link.md) | missing |
| Reading state | queries on Live (`muted /Kick`, current dB) usable in conditions | missing; needs a small query form |
| Conditions | `if … then … else …` on state or exit codes | missing |
| Loops | over tags or ranges beyond what targets already do | mostly covered by tags; real loops missing |
| Time | wait in musical time (`wait 1 bar`), quantized to Live's clock | missing; needs scheduling, a spike |
| Events | triggers beyond clips and scenes: locators, transport start/stop | later, after phase 2 |
| Errors | stop, continue or report per part; one result for a whole script | partly (exit codes, ✓/× dialog) |
| Undo | one Cmd+Z per line or script | needs a spike (transactions across parts) |
| Debugging | dry run (`--dry`), step log, line numbers in errors | missing |
| Editing | the editor page, completion inside scripts | phase 1 uses the note editor |
| Safety | depth and time limits, loop guards, no dialogs | planned in phases 1 and 2 |

The rule for all of it: stay small and shell-like, never throw, every part has an exit code, and nothing
opens a dialog while running from a trigger or script.

## Open questions

- Can several command lines share one SDK transaction (one undo step per script)?
- Do trigger runs during playback clutter Live's undo history, and can they avoid it?
- Is the clip-start event (`playing_status`) reliable with launch quantization and follow actions?
- How does a script refer to "this clip's track" (a placeholder such as `.`, see 0009's targets)?

## Phased rollout

1. **cmdabl-modules / core:** phase 1, `run` and script files, tested through MCP.
2. **cmdabl-bridge:** a spike on clip and scene events plus the push to cmdAbl, measuring latency.
   No commit to the protocol before the user's decision.
3. **After the decision:** the bridge addition, the trigger runner and the setting.
4. **cmdabl-docs:** "Scripts" and "Triggers" in using.md.

## Verification

- `npm test`, `npm run build`.
- Through MCP:
  - a script with three lines runs, and a failing second line stops it with the line number;
  - `run ` completes the script names;
  - the loop guard holds.
- Live (after phase 2):
  - a scene `Drop [> drop]` runs `drop.cmdabl` when launched, also quantized;
  - with triggers off, nothing runs;
  - a clip launched by a follow action runs its script.
