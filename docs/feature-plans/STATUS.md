# Status and next steps

The working state of the project: what is on which branch, what still needs a test in Live, and
what comes next. Maintained by the architect — update it whenever a task lands or priorities
change. Design decisions live in the numbered plans; this file only tracks progress.

_Last updated: 2026-10-11._

## Where the code is

- `main`: contains the command platform rework since 2026-10-11 (PR #9 `refactor/core-modules`,
  squash-merged at the user's request). The Live test was not finished: the rows marked "no" and
  the open steps of the Live test list below still apply, now against `main`. The version is
  still 0.0.1, so the merge published no release.
- `feat/bridge-replies` (from `main`, 2026-10-11; local, not pushed): the roadmap below, the
  Remote Script protocol in 0001 and its build steps. The agents share one working tree, so all
  current work is on this branch.
- `main` is protected since 2026-10-11 by the ruleset "Protect main" (id 24888213): pull request
  required (0 approvals), required checks `build` and `gitleaks`, no force push, no deletion. The
  repository admin may bypass, but only when merging a pull request — a direct push to `main` is
  refused for everyone.
- `docs/sdk-tree-check` (local only, no changes yet): parked task, see "Parked".
- PR #8 `pakabl/index-update` (opened by the daily crawler, not reviewed yet): check the diff —
  if only star counts or push dates in `candidates.json` changed, it is the known noise (see "Parked").

## Built in PR #9 (merged 2026-10-11, Live test still open in parts)

| Area | What | Tested in Live? |
|---|---|---|
| Results | `CommandResult` with exit codes, one presenter, history records only successes | partly (messages seen) |
| Core | `help`, `cmdabl` as the only built-ins; module manifest; provider priority | `help` seen |
| Parser | tokenizer, command tree, validator, parser, `registry.add` / `api.commands.add` | implicitly, through the commands below |
| Resolver | paths → Live objects before the handler; `#n` for same-named siblings | `goto` not-found / ambiguous seen |
| Pick list | shown for ambiguous paths; `Tab` multi-select for multi-target commands | shown for `goto` and `find`; multi-select **not confirmed yet** |
| Commands | `goto`; `mute`/`solo`/`arm` toggle per track, `unmute`/`unsolo`/`unarm` switch off (one undo step; the resolver counts a track named twice once) | `goto` yes; the toggles **no** (rebuilt in `145fd98`) |
| `find` | `find <words> [-t\|-d]`, `next`, `prev` | **yes** (`find`, `-t`, `next`, `prev`) |
| `pakabl` | `pakabl list` unchanged | yes |
| UI contract | `prompt` / `select` / `notify` in `src/core/ui.ts` | no (no behaviour change intended) |
| Fix | Karabiner `cmdabl_open` flag reset on startup | no |
| Team | `CLAUDE.md`, `.claude/agents/`, `scripts/agents.sh` | — |

### Live test list for the work of PR #9 (restart `npm start` first)

1. `help` lists the commands, including `goto`, `find`, `arm`.
2. `goto vermona` → pick list; `Enter` selects; `Esc` does nothing and adds no history entry.
3. `mute vermona` → pick list; mark two with `Tab`; `Enter` flips both; one undo reverts both.
4. Toggles (`145fd98`):
   - `solo /x` twice → on, then off.
   - `mute a b` with one already muted → both flip; one undo reverts both.
   - `mute /a /a` → flips once.
   - `unsolo /x` on a track that is not soloed → nothing changes; same for `unmute`.
   - `arm` on an audio and on a MIDI track → armed, **no message**; `arm` again → disarmed.
   - `arm` on a return or the main track → "cannot be armed"; `unarm` there → no message.
   - `arm` on a group track → "did not change".
   - `arm /a /b` on two ordinary tracks → both armed, no message (with Live's Exclusive Arm
     preference on, only one stays armed and the other is reported — expected).
   - Re-run `mute /x` from history → toggles back (intended).
5. `mute /Opal Lead` (unquoted space) and `mute /a, /b` (comma form) still work.
6. ~~`find vermona` → pick list; then `next` / `prev` step through the matches.~~ Passed.
7. History (`b09108c`, `972b67a`):
   - `mute opal` with one match → history shows `mute "/Opal Lead"`; the re-run asks nothing.
   - Add a second track containing "opal", re-run the entry → still the first track, no pick.
   - `mute /Kick#1 kick`, pick Kick#1 → history shows `mute /Kick#1`.
   - `goto vermona`, pick a device → the history entry re-runs to the same device.
8. `cmdabl --setup` unchanged; an unknown command shows `unknown command`.
9. Check the pick list's size and that the filter field has focus when it opens.
10. Pick list rows (`900f89d`): with two tracks named `Kick`, `mute kick` shows `/Kick#1` and
    `/Kick#2`; a track named `a</script>b` does not break the pick list.
11. Dashes (`d7ba529`, `fa31212`):
    - A track `Kick - Sub`: `mute /Kick - Sub` works unquoted; history shows it quoted.
    - A track `Bass -6dB`: `mute /Bass -6dB` → "unknown option" with the quoting hint;
      `mute "/Bass -6dB"` works.
    - `find "-d"` is remembered as `find "-d"`; `mute -- --help` does not print help.
12. One dialog at a time (`6ad8884`):
    - `help`, then trigger the palette while the message is up → nothing opens; the log says
      `trigger ignored: message`. Dismiss it → the palette opens again.
    - `mute` on a missing track (failure message), dismiss, trigger → opens.
    - `goto vermona` → pick list → `Esc` → trigger → opens.
    - `pakabl list` still opens and its buttons work.
    - If the palette sticks again: look in the `npm start` log for `dialog open: X` without a
      matching `dialog closed`, or `trigger ignored: a command is still running`.
13. pakabl (`504a606`, `9dc9ec7`):
    - `pakabl update` → "index refreshed (16 extensions)", no note about ignored entries.
    - `pakabl list` → Install, Uninstall, Update and Repo each work.
    - `pakabl install ../x` and `pakabl uninstall A.b` → "not a valid extension id"; nothing
      on disk is touched.
    - `pakabl uninstall some.thing` (not installed) → "not installed".
    - Install, then uninstall a real extension → its folder appears, then is gone.
    - `pakabl upgrade federico-pepe.snake@9.9.9` → a version-mismatch failure.
14. Reduced environment for child processes (`c28c70d`, `e1674bf`; step 13 covers pakabl):
    - ~~`cmdabl --setup` → same output as before.~~ Passed in Live.
    - ~~`:` opens the palette, and types a colon while the palette is open.~~ Passed in Live.
    - `man ableton` opens the Live manual in the browser, `man cmdabl` the docs site (once the
      `man` module is in); `cmdabl --help` shows a usage text and opens nothing.
15. Pick list page (`1b305f6`, `d8ca020`; `Space` marking and the `> mute …` line already seen
    working in Live):
    - The dialog opens with focus in the filter; typing works at once.
    - `mute vermona`, type `vermona midi` → the space appears, the list filters, nothing is marked.
    - `↓` → the hint switches to `Space mark` and the first row stays active; `Space` marks it
      and moves on. `↑` from the filter also only enters the list.
    - In the list: stronger row highlight and no caret. A typed letter, `Backspace` or `←`/`→`
      returns to the filter; the marks stay.
    - `Tab` marks in both zones; `Enter` runs on the marked tracks and the history entry equals
      the line; `Esc` cancels without a history entry. A mouse click marks in a multi-select list.
    - `goto vermona` or `find vermona` (single-select): the first `↓` moves to the second row;
      `Space` types a space.
    - A very long track name: the line stays on one row, clipped.
    - A pick with two rows: no scrollbar, nothing cut off (`bd13a52`).
16. `man` and `cmdabl --help` (`fcb7296`, `69452e9`):
    - ~~`man ableton` → the Live manual opens; `man cmdabl` → the docs site.~~ Passed in Live
      after `827f326`. Still open: `man Ableton` (capital letter) → the same.
    - `man ableton warp modes` → Ecosia opens with results from the Live manual only (which
      language?);
      `man ableton it's a & b` → the words arrive intact; `man cmdabl foo` → "cmdabl has no
      search"; the history entry of a search re-runs it.
    - `man` → usage with the topics; `man foo` → `no manual for "foo"` and the topics;
      `man ableton extra` → a usage error.
    - `help` lists `man`; a successful `man ableton` is in the history and re-runs.
    - `cmdabl --help` and bare `cmdabl` show the usage text; `cmdabl --foo` adds `unknown flag`.
17. Messages (`1b6d254`, `b6b208a`):
    - ~~`man foo` (one line) → a small window, no scrollbar; `Esc` and `Enter` close; the long
      path in `cmdabl --setup` wraps.~~ Passed in Live.
    - `cmdabl --help` → passed in Live. `help` → every line on one row, the last line visible, no scrollbar
      (failed with `b6b208a`; corrected in `5e6b339`).
    - `cmdabl --setup` → "Remote Script is linked to … (nothing to copy)", no `cp:` line.
    - Where a scrollbar does appear, it is thin and dim (`158502d`).
    - `Esc` closes, `Enter` closes; `↓`/`PageDown` scroll a long text; Close stays visible.

### Found in the Live test (2026-10-11, still running)

- Passed so far: `help`, pick list for `goto` and `find`, `find -t`, `next`/`prev`, `pakabl list`.
  Later the same day: `Space` marking and the command line with `mute`; `man ableton`, `man cmdabl`.
- The `help` window is too small (text wraps at 500×180) — see "Dialog size" in 0007.
- Open decision: do `next`/`prev` stay once the pick list has a follow mode? Kept until the spike.
- **Palette stuck "open"**: after some tests (last command probably `mute`) the palette could not
  be opened until `npm start` was restarted; `/state` answered `open`, no window was visible, no
  log captured. Suspected, unverified: a message dialog (`notify`, not covered by `isOpen`) was
  still up when the palette was triggered. Task out to cmdabl-core: one dialog at a time, "open"
  covers messages, log lines for open/close. **The cause stays unverified after that lands**: the
  queue does not help if a dialog promise never settles; the new log lines are there to tell.
- **`pakabl list` opens its dialog itself** (`src/modules/pakabl/index.ts`), outside the `Ui`
  contract and the dialog queue. No collision today. **Decided by the user (2026-10-11): option
  (a)** — a fourth generic surface (`page`) on `Ui`, reachable through `ModuleApi`; `pakabl list`
  keeps its page. Not built yet; it is a contract change for cmdabl-core, to be ordered with the
  candidates (the manual index needs a pick list for non-Live items, a related change).
- `pakabl list` inlined downloaded index data unescaped (`</script>` in a name breaks the page).
  Task out to cmdabl-modules, using core's `inlineJson`.
- `Space` "did not mark" in the pick list: resolved, not a bug. The user had used `find`, which is
  single-select; with `mute` marking and the command line work in Live.
- The first `↓` skipping the first row felt odd. Changed in `d8ca020`: in a multi-select pick the
  first arrow only enters the list.
- **`man ableton` refuses a valid URL** (`refusing to open "https://www.ableton.com/en/manual/"`).
  `new URL()` in `src/core/openUrl.ts` fails in the Extension Host although it works in plain Node
  and in the unit tests. Suspected, unverified: the `URL` global is missing in the host's context.
  Task out to cmdabl-core: validate without the global, never swallow the reason, log at startup
  which web globals the host has. If confirmed, it belongs in `docs/sdk-tree.md` as a constraint.
  Fixed in `827f326` (plain string check, no `URL` global; reviewed) — **the cause is still a
  hypothesis** until the startup log line `cmdAbl: host globals: …` has been read in Live.
  **Confirmed 2026-10-11:** the host reports `URL`, `URLSearchParams`, `structuredClone`,
  `TextEncoder` and `crypto` as `undefined` (`fetch`, `AbortController` exist). Recorded in
  `docs/sdk-tree.md`, section 7.
- `cmdabl --setup` works with the reduced environment (rule already linked, Remote Script
  installed). Its message has a horizontal scrollbar: a long path does not wrap, and the window is
  too small again. Task out: the page wraps (cmdabl-ui), then the host sizes the window from the
  text (cmdabl-core).
- The dialog log lines work (`dialog open: palette`, `dialog closed: palette (returned a value)`,
  `dialog open: message`).
- Message sizing in Live (`b6b208a`): a one-line message and `cmdabl --setup` are right; `Esc` and
  `Enter` close. `help` and `cmdabl --help` still wrap their longest line and get a scrollbar: a
  character is about 8.0 px wide in Live's webview, not 7.83 as in headless Chrome. The requested
  height is the content height (the title band is extra), line height 18 px is right. The
  scrollbar track is bright white.
- `cmdabl --setup` prints a raw `cp: … are identical (not copied)` line when the Remote Script
  folder is a symlink to the repo.
- `5e6b339` in Live: the linked-Remote-Script line is right. `cmdabl --help` still scrolls — the
  window is about 1.5 px too low (the fixed height around the text is about 66.5 px in Live, not
  65), the scrollbar then narrows the text and the long line wraps. The scrollbar is still a
  white native one in the message page and in `pakabl list`; `158502d` has no visible effect.
- **Confirmed in Live after `ac885e2` and `63bba87`:** `cmdabl --help` shows all six lines on one
  row each without a scrollbar; the scrollbar in `pakabl list` is slim and dim (the dark colour
  scheme and the single rule family work in Live's webview). Still to look at: `help`, a long
  pick list, the palette dropdown, caret and selection.
- **Confirmed in Live (evening):** `:` opens the palette by shortcut and types a colon while it is
  open (reduced environment works with Karabiner); `pakabl list` → Install put "Device Manager"
  into Live's Extensions settings; `man ableton warp modes` opens Ecosia, and the provider honours
  the path in `site:`.
- `arm` on a track that cannot be armed does nothing and shows no message (the SDK write neither
  throws nor takes effect). Task out to cmdabl-modules.
- The Ecosia results mix manual versions 11 and 12. Narrowing to `/live-manual/12`.
- **Palette stuck again, now with evidence (20:59):** `arm` on the group track "Analog Rytm", run
  twice, showed no message; the next trigger logged `dialog open: palette` and nothing after it —
  no window in Live, `/state` answers `open`, only a restart helps. So `showModalDialog` was
  called and neither showed a window nor settled. Suspected, unverified: the rejected write
  inside `withinTransaction` leaves something pending on Live's side. Mitigation (cmdabl-modules):
  refuse `arm` on group tracks before writing. Investigation (cmdabl-bridge).
- `arm` on a MIDI track whose input device is missing (arm button greyed out) shows no error. Not
  yet known whether the build with the read-back was running; if it was, the SDK cannot tell and
  it needs the Remote Script (`can_be_armed`, replies).

### Dialog hang — what is known (cmdabl-bridge, 2026-10-11)

- Evidence: `track.arm = v` is a synchronous native call wrapped in its own transaction; the SDK
  has no channel for a failure that arrives later. Our handler is synchronous and nothing in the
  code drops a rejected promise. The log shows no `dialog failed` and no `trigger ignored`: the
  hang is inside `showModalDialog`, whose promise never settles.
- `arm` is a toggle, so the two runs on the group were arm, then unarm. The palette opened fine
  after the first. No message is the expected result of a write that does not throw and reads
  back equal — it is not evidence that Live refused it.
- So "a write to a group track" is **not** established as the cause. The earlier hang followed a
  `mute`. The shared factor: a data-model write ran in the continuation of a pick dialog's close,
  and a later dialog request then hung.
- Hypotheses: (H1) group arm specifically; (H2) a transaction executed inside a modal's close
  callback overlaps the modal's teardown, timing dependent; (H3) unrelated to writes; (H4) Live
  holds the dialog because of a pending undo step.
- Experiments for the user (group arm is refused since `aa98b7a`, so use `mute`): `mute` on a
  normal track through the pick list several times, then by direct path (separates "write after a
  pick" from "write"); after a hang: what Live's Edit menu shows for Undo, whether Cmd+Z
  brings the dialog, whether switching apps reveals a hidden window.
- **Result of the experiment (user, 2026-10-11):** `mute` through the pick list about ten times
  and by direct path about ten times: no hang in either round. H2 is not supported (not excluded
  either, it would be timing dependent). The hang is rare and cannot be reproduced on demand, so
  neither candidate fix below is shipped: there is nothing to verify it against.
- Next step instead: better evidence for the next occurrence (task to cmdabl-core): a log line
  per command run (line, exit code, duration), and a manual `/reset` on the local trigger server
  that clears the "dialog open" state, to learn whether a new dialog can open after a hang
  without restarting. The checks after a hang stay: Undo entry in the Edit menu, Cmd+Z,
  switching apps.
- Built in `689e673`: log lines `run start: <typed line>` and
  `run: <canonical line> -> <code|cancelled|threw> (<ms> ms)`; `dialog open: X (N ms after the
  previous dialog closed)` and `dialog closed: X (…, open for N ms)`; and
  `curl -X POST http://127.0.0.1:27184/reset` (local only, refuses requests with an `Origin`
  header, `GET` answers 405). `/reset` is temporary and only for after a hang: on a healthy
  dialog it drops the result and the next trigger opens a second modal over the first; queued
  messages are lost; `pakabl list` opens outside the queue, so a hang there answers "no dialog
  was open".
- Live test: (1) after a restart, `mute <track>` and an unknown command show the `run start`,
  `run:` and timed `dialog` lines; (2) with nothing open, `POST /reset` answers "no dialog was
  open" and `GET /reset` answers 405; (3) after the next real hang, before restarting: Undo
  entry, Cmd+Z, app switch, then `POST /reset`, press `:`, and report whether a palette appears
  plus the log from the last `run start:` line on.
- `arm` on a MIDI track whose input device is missing (arm button greyed out in Live): no message
  even with the read-back of `e885674` running (user, 2026-10-11). The SDK accepts the write and
  shows no difference; detecting it needs Remote Script replies (`can_be_armed`), see "Roadmap to 0.1.0", step 2.
- Candidate fixes, kept until a hang can be tied to a cause: run the handler one macrotask after
  a dialog closes (cmdabl-core); drop the outer `withinTransaction` for a single-track write.

### In progress (tasks out, 2026-10-11)

| Task | Agent | State |
|---|---|---|
| `mute`/`solo`/`arm` toggle again; `un…` stay as "off" (0005) | cmdabl-modules | committed `145fd98` + `083c288`, reviewed; needs the Live test (step 4 above) |
| `SelectRequest.preview` and `items[].value` for the command line in the pick list (0007 §4) | cmdabl-core | committed `900f89d`, reviewed (also escapes `<` in the data inlined into all three dialogs); the line itself is not visible until the page task is done |
| Remembered line fully canonical: unique paths, each object once (0005) | cmdabl-core | committed `b09108c` + `972b67a` (option parsing fix, reviewed OK). `b09108c` alone has one failing test — squash before merging if a clean history matters |
| Dash handling: quote leading-dash words in the remembered line, `--` ends options, lone `-` is a word, hint in "unknown option" (0005) | cmdabl-core | committed `d7ba529` + `fa31212`, reviewed; needs the Live test (step 11 above) |
| One dialog at a time, "open" covers messages, open/close log lines | cmdabl-core | committed `6ad8884`, reviewed; needs the Live test (step 12 above). Behaviour change: a trigger while a message is up is ignored |
| `inlineJson` in its own file; `pakabl list` escapes the index data with it | cmdabl-core, then cmdabl-modules | committed `cc5c62f` + `504a606`, reviewed; Live: `pakabl list` and its buttons as before |
| pakabl hardening: validate ids before unzip and delete, open only repo URLs from the index, fail on a missing page placeholder | cmdabl-modules | committed `9dc9ec7`, reviewed; needs the Live test (step 13 above). Behaviour changes: pakabl errors are failing results now (no history entry); `pakabl uninstall` refuses folder names outside the id shape, e.g. hand-installed ones |
| Child processes get an allowlisted environment instead of all of `process.env` (`src/setup.ts`, pakabl's `platform.ts`) | cmdabl-core, then cmdabl-modules | committed `c28c70d` (setup and `cmdabl --help`) + `e1674bf` (pakabl), reviewed; no spawn passes the whole environment any more; needs the Live test (steps 13 and 14). `cmdabl --help` off macOS now returns exit code 5 with the URL instead of spawning `open`; Windows untested |
| `pakabl list` page sends `repo:<id>` instead of a URL (one line in `ui/pakabl-list.html`) | cmdabl-modules (host), cmdabl-ui (page) | committed `82beafd` + `4a479ce`; needs the Live test: the Repo button opens the extension's GitHub page (step 13) |
| Pick list page: two zones (`Space` marks in the list), command line (0007 §4) | cmdabl-ui | committed `1b305f6`, reviewed; keys checked with a scripted browser run, the look is unchecked; needs the Live test (step 15 above). Dialog height for the extra line: cmdabl-core, committed `bd13a52`, reviewed |
| Pick list: first arrow enters the list without moving; robust `Space` detection; `Ctrl+Shift+D` key diagnostic | cmdabl-ui | committed `d8ca020`, reviewed; needs the Live test (step 15) |
| Secret scan in CI (`.github/workflows/secret-scan.yml`, gitleaks 8.30.1 pinned by checksum, `docs/guides/ci.md`) | cmdabl-core | committed `1092e4e`, reviewed. Full history scanned locally: 0 findings. Verified on GitHub after the push: the push run and the pull-request run (78 commits) scan their ranges, a manual run scans the whole history (117 commits) — no leaks |
| Pin `peter-evans/create-pull-request` in `pakabl-index.yml` to a commit SHA | cmdabl-core | committed `a5e1adc` (v7.0.11), reviewed; the next manual run of the index workflow after a push is the check |
| `cmdabl --help` prints usage instead of opening the Ableton manual; `openUrl` in its own file | cmdabl-core | committed `fcb7296`, reviewed. The usage text points to `man cmdabl` — **do not push before the `man` module is in**. Live: `cmdabl --help` and bare `cmdabl` show the usage, `cmdabl --foo` adds `unknown flag`, `cmdabl --setup` unchanged |
| New module `man`: `man ableton` (Live manual), `man cmdabl` (docs site) | cmdabl-modules | committed `69452e9`, reviewed; needs the Live test (step 16). On Windows `man` answers with the URL (exit 5) until core's `openUrl` has a Windows opener |
| pakabl's Repo button opens through core's `openUrl` (macOS); the Windows branch stays, with an https check | cmdabl-modules | committed `931615b`, reviewed; Windows untested |
| `man ableton <words>`: DuckDuckGo search limited to the manual (`site:ableton.com inurl:live-manual`; the user chose the engine) | cmdabl-modules | committed `0db7d6b`, reviewed; needs the Live test (step 16). Quotes are not passed on (no exact phrase); a word starting with `-` needs `--`; the typed words go to DuckDuckGo |
| Manual search uses Ecosia instead of DuckDuckGo (`site:ableton.com/en/live-manual`; user decision) | cmdabl-modules | committed `ddd15cb`, reviewed; needs the Live test: does Ecosia honour the path in `site:`, and is the English manual (`/en/`) the wanted one? |
| Message page: long lines wrap, Close stays visible, `Esc`/`Enter` close; then the window height follows the text | cmdabl-ui, then cmdabl-core | page committed `1b6d254`, reviewed (checked in headless Chrome only; held-key repeats do not close a message; arrows and PageDown scroll the text); window sizing committed `b6b208a`, reviewed (width 500…760, height 110…420; short messages now open smaller); needs the Live test (step 17) |
| Message sizing with Live's character width (8.05 px); setup reports a linked Remote Script instead of the `cp` line | cmdabl-core | committed `5e6b339`, reviewed; needs the Live test (step 17). The first direct `node:fs` call in host code (`src/core/samePath.ts`, fails soft) — note it in `docs/sdk-tree.md` once Live confirms |
| Themed scrollbar in the dialogs (`ui/shared.css`) | cmdabl-ui | committed `158502d`, reviewed; checked in headless Chrome for the message and pick pages only; needs the Live test (thin dim scrollbar, no white track, in all four pages) |
| Message height: fixed part 65 → 72 px | cmdabl-core | committed `ac885e2`, reviewed; needs the Live test: `cmdabl --help` shows six lines without a scrollbar |
| Scrollbar still white in Live: `color-scheme: dark`, one rule family per engine, better integration | cmdabl-ui | committed `63bba87`, reviewed; verified in headless Chrome only, **not in Live's webview**; needs the Live test (slim dim bar in all four pages, caret and selection still readable, no white flash on open) |
| `arm` reports tracks that cannot be armed; manual search pinned to `/live-manual/12` | cmdabl-modules | committed `e885674` + `9edd84f`, reviewed; needs the Live test (step 4). The read-back after arming is unverified against the SDK: if ordinary tracks report "did not change", it comes out again (one function) |
| Docs workflow's build job gets its own check name (`docs-build`) | cmdabl-core | committed `e23c043`, reviewed; the next pull-request run on GitHub is the proof (three checks: `build`, `gitleaks`, `docs-build`) |
| `arm` refuses group tracks before writing | cmdabl-modules | committed `aa98b7a`, reviewed; needs the Live test. It avoids one possible trigger; it does not explain the hang |
| Why a dialog never appears after a write to a group track's `arm` (transaction, rejected write) | cmdabl-bridge | findings in (no code changed), see "Dialog hang" above; the user's experiment did not reproduce it |
| Evidence for the next dialog hang: log line per command run, manual `/reset` on the trigger server | cmdabl-core | committed `689e673`, reviewed; needs the Live test (see "Dialog hang" above) |

Decided by the user: the parser stays strict for dash-words in unquoted names (0005, "Dash rules").

### Secrets (rule from the user, 2026-10-11)

No environment variable or secret may reach the git history. An API key is exported in every
shell on the user's machine. Agents do not print environments, refer to variables by name only,
and the reviewer checks every diff for secret-shaped strings. The architect scans the commits to
be pushed before every push. `.env*`, `.envrc`, `*.pem`, `*.key` are git-ignored. Scan of all
refs and the working tree on 2026-10-11: clean.

## Roadmap to 0.1.0

0.1.0 means: the first version someone else can install on macOS and rely on. Decided by the user
on 2026-10-11: 0.1.0 is macOS-only, and the completion engine (0006) comes after it. The order
below was approved by the user the same day.

### 1. Reliable (blocks everything else)

1. Finish the Live test of the merged work. Seen working by the user on 2026-10-11, after the
   merge: `arm` refuses a group and the palette keeps opening; `mute` toggles and `unmute` on an
   unmuted track changes nothing; `arm` on a normal track (no message) and on a return track
   ("cannot be armed"); history rows in the empty palette and running one; a trigger during a
   message opens no second window. Still open: pakabl Update/Uninstall/Repo, the dash rules,
   sizing of long lists.
2. Dialog hang ("Dialog hang — what is known" above): 0.1.0 does not ship with "only a restart
   helps". Either the cause is found and fixed, or the palette recovers by itself (a watchdog in
   `src/core/dialogQueue.ts` that abandons a dialog which never appeared — only buildable once a
   `/reset` after a real hang has shown that a new dialog can open). If the SDK allows neither:
   a documented known issue and a report to Ableton.
3. Remove the temporary `POST /reset`, or turn it into that recovery.

### 2. Remote Script as a two-way channel (cmdabl-bridge) — the main piece

Plans: 0001 Phase 4, decisions in 0004. Today the bridge is fire-and-forget over UDP 27185.

1. Protocol with replies — **confirmed by the user on 2026-10-11** as proposed in 0001, "Phase 4
   protocol proposal" (`c9a1d18`): UDP 127.0.0.1:27185, `{v, id, op, args}` →
   `{v, id, ok, result | error}`, timeout 500 ms, `hello` → `{script, v, ops}`. Decided with it:
   no `hello` reply → exit code 5 with what to do; the Live Set changed since the command was
   typed (route out of range, name differs) → exit code 1 "the Live Set changed; run the command
   again"; a faster drain than Live's display rate only if a measurement asks for it; no access
   token while the operations only select and read — mandatory before the first operation that
   changes or deletes. Behaviour change from build step 2: with the old script installed,
   `goto` answers "installed Remote Script is outdated; run `cmdabl setup` and restart Live".
   The bridge sits behind an interface with a fake for tests; replies are validated where they
   arrive. Build steps: 0001 §7; step 1 is out to cmdabl-bridge.
2. Availability: the extension knows whether the script is installed, running and of a matching
   version; commands declare `requires: ["bridge"]` (0005) and answer with exit code 5 and a
   clear text instead of doing nothing.
3. Install and update for a user: `cmdabl setup` installs or updates the script, detects a
   version mismatch after an extension update and says when Live must be restarted.
4. Operations, in this order: `select` with read-back (`{route, expectName}`); track facts the
   SDK lacks (`can_be_armed`, "is a group" — `arm` on an unarmable track then reports it); Drum
   Rack chains and pads with their real names in the object tree, pad selection
   (`find vermona kick`); reading the current selection (for restoring it later in follow mode).
5. Unit tests for the protocol on both sides; a Live test list per operation.

### 3. Freeze the command syntax (cmdabl-core, cmdabl-modules) — the rest of 0005

Changing these after a release breaks what users have learned and what is stored in history.

1. `cmdabl` and `pakabl` as subcommand groups (`cmdabl setup`; the old flags stay as aliases).
2. An `enum` argument kind with declared choices (`man <ableton|cmdabl>`, pakabl ids): usage
   text and, later, completion come from it.
3. Object items of the palette run through `goto` (history entry, `next`/`prev` list); removes
   `registerResultHandler` — a `ModuleApi` change, to be confirmed with the user first.
4. Ports instead of the raw SDK context in `ModuleApi`, then the command-authoring guide
   (`docs/guides/adding-a-command.md`).
5. Leftovers from before the rework (checked 2026-10-11): `pakabl`, `help` and `cmdabl` still
   use the older `registry.register` path and parse their own flags (goes with 3.1; then remove
   `ModuleApi.registry`); platform files still outside `src/core/` (`src/commandRegistry.ts`,
   `src/types.ts`, `src/providers/commandProvider.ts`, `src/setup.ts`) and an empty `src/ui/`
   folder — move them and extend the import-boundary test. No unused module was found.

### 4. Small things that make it feel finished

- Import-boundary test: built in `921dd43` (`src/architecture.test.ts`, rules in 0005, "Import
  boundaries"); 125 unit tests pass. One listed exception left: `pakabl list` opening its
  own dialog (goes away with the `page` surface below); the `find` match tests moved to
  `src/modules/find/` in `9ee97c3`. From an outside
  architecture review the user brought in; its other points are already true or are step 3.4.
- Feedback for `next`/`prev` (e.g. `2/5 /path`).
- A generic `page` surface on `Ui` for module pages (decided, see above); `pakabl list` moves
  onto it and into the dialog queue.
- A larger maximum size for the pick list (0007).
- Clean "not supported on this platform" answers everywhere off macOS.

### 5. Release 0.1.0

- User documentation on the docs site: install, `cmdabl setup` (Remote Script, trigger key),
  command reference, known limits (macOS-only, SDK beta).
- From "Parked", what affects a release: the runner image before 2026-10-19, index pull requests
  that start the required checks, the pakabl index noise.
- Release test: install the packaged `.ablx` into a Live without Developer Mode, run setup, run
  the full Live test list once.
- Bump the version in `package.json` and `manifest.json`, merge; the release workflow publishes.

### After 0.1.0 (order to be set then)

- 0.2.0: the completion engine (0006) — ghost text, level-by-level paths; builds on the tree
  from step 2.
- Keymap (0006): UI keys as named actions, a user `keymap.json`, keys bindable to command lines.
- Dialog-channel spike (the four checks in 0006), then follow mode for the pick list (0007 §4)
  and navigation mode; whether `next`/`prev` stay is decided with it.
- 0007: theme file, replacement pages with fallback, `api.ui.register`; configurable dialog
  sizes.
- **Wanted by the user (2026-10-11): an index of the Ableton manual** for `man ableton <words>`
  instead of a search-engine query: match the words against chapter and section titles (chapters
  are `/en/live-manual/12/<chapter>/#<section>`) and open the section, with the pick list on
  several hits (needs a pick list for things other than Live objects — a `ModuleApi` change).
- History as a log (user, 2026-10-11: wanted, but later): `history` shows the last commands
  newest first with success or failure, `Enter` runs a row again; failed commands are kept in
  the log too. Today the entries are only the first rows of the empty palette, marked
  `(history)` — at most 20, in memory only. Open: whether Live's Undo History can be opened
  from the extension or the Remote Script (cmdabl-bridge checks during step 2).
- Windows: an opener in core's `openUrl`, a trigger key, Remote Script install paths, a tester.

## Parked

- **`docs/sdk-tree.md` check**: approved earlier, then interrupted — update the header to name
  SDK 1.0.0-beta.1 and the vendored tarball, add `DataModelObject.handle`/`.parent`, and add
  `scripts/check-sdk-tree.ts` (names in the doc vs. the vendored type definitions, wired into CI).
- **pakabl index noise**: `candidates.json` stores star counts and push dates, so the daily
  workflow can open a PR when nothing relevant changed. Fix: only rewrite it when the set of repos
  or `.ablx` names changes.
- **First-party actions by tag**: `actions/*` are pinned by tag (`@v4`, …) in the four older
  workflows; pin them by SHA when convenient. The third-party one is being pinned now.
- **pakabl index workflow permissions**: the crawl step runs over third-party repositories and
  their `.ablx` files with a token that may write (`contents`, `pull-requests`), because the
  permissions are set for the whole workflow. Split into a read-only crawl job that uploads the
  two JSON files and a second job that only opens the pull request. Fits together with the
  index-noise fix above.
- **Index pull requests and the required checks**: a pull request opened by the crawler with the
  workflow's own token does not start workflows, so PR #8 has no checks and shows as blocked. The
  admin can still merge it (bypass), or close and reopen it to start the checks. A proper fix is
  for the crawler to open its pull request with a token that triggers workflows.
- **CI runner image**: `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19; the crawler needs `unzip`.
  Pin `ubuntu-24.04` in the workflows or verify after the switch.
- **Old remote branches** `features` and `feature/path-addressed-objects`: the user has not decided
  whether to delete them.

## Deferred on purpose

Typed pipelines (`find … | mute`), macro recording, an adapter for external programs, loading
third-party modules at runtime (blocked by the SDK). Reasons and triggers are in 0004.
