# Scripts and triggers: `.cmdabl` files, run from clips and scenes

**Status:** Draft (2026-10-23). First in the order after 0.1.4 (user). The bridge protocol addition
(phase 2) is not decided yet: the user decides after reading this plan. Trigger: run command scripts from
clips and scenes, so Live's Session grid works as a grid of commands.

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
- **The bridge addition (not decided):** the script pushes `{event, track, scene, name}` to cmdAbl, which
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
- Named values, conditions on Live state, waiting in musical time: each with its own plan.

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
