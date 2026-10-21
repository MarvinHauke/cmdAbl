# Logging: what goes where, a core logger and `cmdabl log`

**Status:** Built (2026-10-20) for 0.1.2: core `e7ff3e8`, `9d2fda1`, `c5ce946`; modules `6a958fe`,
`9e15cff`; bridge `94c1648`. Live test pending. Quiet tag writes ship only together with
`cmdabl log --undo` (reviewer, architect decision 2026-10-20), so the undo commands stay reachable.
Log lines now read `cmdAbl [<source>] <level>: …`, so filter on `cmdAbl [`.
Trigger: after Apply on the tag board, a message window listed every change with its `undo:` lines.
The user wants that report in the log, not in a dialog.

**Parent:** [0004](0004-command-platform.md)
**Related:** [0002](0002-command-feedback-pattern.md) (the feedback pattern, extended by the rule
below) and [0010](0010-tag-editing.md) (Apply closes quietly).

## Context

How cmdAbl logs today:

- **Extension**
  - About 20 direct `console.log` and `console.error` calls, each with a hand-written `cmdAbl:`
    prefix, in `httpTrigger.ts`, `extension.ts`, `core/ui.ts` and `core/commandRegistry.ts`.
  - Some code gets an injected sink:
    - `runLine` (`src/core/run.ts`) logs `run start` and `run: <line> -> <code> (ms)`;
    - `dialogQueue.ts` logs when a dialog opens and closes;
    - `parseBoardAnswer`, `tagCache.ts`, `chainNames.ts` and `bridgeToken.ts` log their own
      problems.
  - Modules call `api.log(line)` (`src/modules/types.ts`), which is `console.log` (`extension.ts`).
- **Remote Script:** `self.log_message` writes to Live's `Log.txt`.

What is missing:

- log levels;
- the name of the module or source on each line;
- a way to see the log inside Live;
- a written rule for what goes where;
- the result message: it is never logged, only its exit code is.

Done means:

- a successful write is quiet;
- its report and undo lines are in the log;
- `cmdabl log` shows the log in Live;
- every log line goes through one logger.

## Decisions (user, 2026-10-20, approved with this plan)

1. **Three channels.** This extends 0002:

   | Channel | What goes there |
   |---|---|
   | Dialog | Failures, questions, and output the user asked for (`tag -l`, `man`, `cmdabl bridge`, `help`) |
   | Silence | A successful write. The presenter already shows nothing for code 0 without a message. |
   | Log | Everything else: what changed, undo lines, timings, diagnostics |

2. **`CommandResult.log?: string[]`** (additive contract change).
   - The platform writes these lines to the log at `info`, under the command's name.
   - The presenter never shows them.
   - A successful write returns no `message`, only `log`.
   - Partial failures still show the ✓/× dialog, as today.
3. **A write that changes nothing says so** (modules `8134f55`, after the Live test): "/Bass already
   has #bass", "/Bass has no #fx", or "nothing changed" for several targets; a mix of changed and
   unchanged targets stays quiet. "A successful write shows nothing" holds only for writes that
   changed something.
3b. **Tag writes go quiet.** This covers board Apply, `tag /x fx`, `tag -e` and `tag --set`.
   - The change lines and `undo:` lines go into `log`.
   - After an Apply with failures, the dialog shows only the failures.
4. **A core logger, `src/core/log.ts`.**
   - Levels: `debug | info | warn | error`.
   - Line format: `cmdAbl [<source>] <level>: …`.
   - Every line has a timestamp (user, 2026-10-20). The console shows `HH:MM:SS.mmm cmdAbl [<source>] <level>: …`;
     `cmdabl log` shows `HH:MM:SS [<source>] <level>: …`, with a date line where the day changes; `--undo` stays bare commands.
   - A ring buffer keeps the last 500 lines in memory.
   - `debug` lines are dropped unless `cmdabl log --debug` turned them on for the session.
   - `ModuleApi.log` stays: it logs `info`, tagged with the module name.
   - An additive `api.logger.{debug,info,warn,error}` is added.
5. **No `console.` calls outside `log.ts`.**
   - An architecture test enforces this.
   - Each owning agent moves its own calls.
6. **No secrets in the log.** No token, secret value or environment variable goes into any log line.
   This is already practice (`bridgeToken.ts`, `access_token.py`), and the reviewer checks it on
   every change.
7. **`cmdabl log`** shows the log on a `notify` page.
   - `cmdabl log` shows the last 50 lines, newest at the bottom.
   - `-n <count>` shows more.
   - `--debug` turns debug lines on for the session.
   - `--undo` shows only the `undo:` lines, because Cmd+Z does not undo tags.
8. **No logging agent.** Logging is a rule that applies to every area, not a set of files. Each
   builder logs in its own area, and the reviewer checks the rules.

## Deferred

- A log file next to the settings, so the log survives a restart.
- Levels for the Remote Script. For now it only gets a matching `cmdAbl [script]` prefix.

## Phased rollout

1. **cmdabl-core**
   - `log.ts` with tests;
   - the `CommandResult.log` field and the presenter;
   - `api.logger`;
   - `cmdabl log`;
   - move core's and the extension's `console` calls;
   - the architecture test.
2. **cmdabl-modules**
   - `tag` writes return `log` instead of `message`;
   - `api.log` callers stay unchanged.
3. **cmdabl-bridge**
   - move its `console` calls;
   - give the Remote Script's `log_message` lines the `cmdAbl [script]` prefix.
4. **cmdabl-docs**
   - a short "Logs" section in using.md;
   - the tag text: "Apply closes; `cmdabl log --undo` shows the undo lines".

## Verification

- `npm test`:
  - the logger's levels and ring buffer;
  - a result with code 0 and only `log` shows nothing;
  - the architecture test fails on a new `console.` call.
- `npm run build`.
- Live:
  1. Apply two changes on the board: no window opens. `cmdabl log` shows the two changes and their
     `undo:` lines.
  2. `tag /Lead fx` opens no window.
  3. Turn the Remote Script off, then Apply: the error dialog appears.
  4. `cmdabl log --undo` shows only the undo lines.
  5. The `npm start` terminal shows the `cmdAbl [tag] info:` lines. Note where an installed build
     writes them.
