# Status and next steps

The working state of the project: what is on which branch, what still needs a test in Live, and
what comes next. Maintained by the architect — update it whenever a task lands or priorities
change. Design decisions live in the numbered plans; this file only tracks progress. Finished
work is in the git history, not here.

_Last updated: 2026-10-12._

## Where the code is

- `main`: contains the command platform rework since 2026-10-11 (PR #9 `refactor/core-modules`,
  squash-merged at the user's request). The Live test was not finished; the list below applies
  against `main`. The version is still 0.0.1, so the merge published no release.
- `feat/bridge-replies` (from `main`, 2026-10-11; local, not pushed): the roadmap below, the
  Remote Script protocol in 0001 and its build steps. The agents share one working tree, so all
  current work is on this branch.
- `main` is protected since 2026-10-11 by the ruleset "Protect main" (id 24888213): pull request
  required (0 approvals), required checks `build` and `gitleaks`, no force push, no deletion. The
  repository admin may bypass, but only when merging a pull request — a direct push to `main` is
  refused for everyone.
- `docs/sdk-tree-check` (local only, no changes yet): parked task, see "Parked".
- PR #8 `pakabl/index-update` (opened by the daily crawler, not reviewed yet): check the diff —
  if only star counts or push dates in `candidates.json` changed, it is the known noise.

## Roadmap to 0.1.0

0.1.0 means: the first version someone else can install on macOS and rely on. Order approved by
the user on 2026-10-11 (macOS-only; the completion engine, 0006, comes after).

### 1. Reliable (blocks everything else)

1. Finish the Live test of the merged work: see "Open Live tests".
2. Dialog hang (see "Known issues"): 0.1.0 does not ship with "only a restart helps". Either the
   cause is found and fixed, or the palette recovers by itself (a watchdog in
   `src/core/dialogQueue.ts` that abandons a dialog which never appeared — only buildable once a
   `/reset` after a real hang has shown that a new dialog can open). If the SDK allows neither:
   a documented known issue and a report to Ableton.
3. Remove the temporary `POST /reset`, or turn it into that recovery.

### 2. Remote Script as a two-way channel (cmdabl-bridge) — the main piece

Plans: 0001 "Phase 4 protocol", build order 0001 §7, layout 0001 §8, decisions in 0004.

1. Protocol with replies (confirmed by the user 2026-10-11 as proposed in 0001): UDP
   127.0.0.1:27185, `{v, id, op, args}` → `{v, id, ok, result | error}`, timeout 500 ms,
   `hello` → `{script, v, ops}`. Built: protocol, `hello`, `Bridge` interface, fake,
   installed-script check (`99b6e00`, `3b37b0d`, `6d899db`); `cmdabl --bridge` and a temporary
   `GET /bridge` (`e4fa6f3`, `730fbfb`; seen in Live 2026-10-11: 14 ms, 24 ms with the palette
   open; the script answers while a dialog is open; Live must be restarted after
   `cmdabl --setup`, re-selecting the control surface was not enough); `requires: ["bridge"]`
   (`25b467a`, 0005 "`requires` as built"); script 0.2.0 layout (`ops/`, `routes.py`, `legacy.py`
   for the old one-way messages) and `select` with name check and read-back (`50ced39`,
   `84f8865`); `goto`, `find`, `next`, `prev` and the palette's object rows select through it and
   declare `requires` (`8587279`).
   - Behaviour change: with an old or missing script these answer "outdated / not installed /
     not running" (`goto` with the old script: "installed Remote Script is outdated; run
     `cmdabl setup` and restart Live"); a failed selection is a failing result (not remembered).
     **Live test still open** ("Open Live tests", 1). Unverified until then: read-back equality
     in Live, the main track's name, selecting a rack chain.
   - Response time: 20 round trips measured in Live (user, 2026-10-11, script 0.2.0; `9c55d49`):
     min 4 ms, median 62 ms, max 98 ms — the 0–100 ms wait for the display tick. Research on a
     faster drain (0001 §6, `76bbb5d`): the tick is 0.1 s in Live's bundled framework;
     `schedule_message` gives no gain; the one option is a `Live.Base.Timer` at about 20 ms
     (main-thread behaviour and CPU cost unmeasured). No timer for now (see "Decisions").
   - Old one-way messages removed (`a462647`). Step 3 built: `track_facts` (`1d625db`, script
     0.3.0; `trackFacts()` in `bridgeOps.ts`: `canBeArmed`, `isGroup`, `isGrouped`, `arm`, one
     request for up to 20 tracks). Unverified until Live: `can_be_armed` for a MIDI track
     without its input device, for a group and for the main track. Task out to cmdabl-modules:
     `arm` uses the facts when the script is there and behaves as today when it is not (`arm`
     does not require the bridge). Built in `7e4d787` (reviewed): one `track_facts` request
     before the write; `canBeArmed` false → "Live does not allow arming this track (e.g. no
     input device)"; without the script exactly today's behaviour. A cached "unavailable" is
     not retried by `arm` (noticed after `cmdabl --bridge` or a `goto`). Live test: "Open Live
     tests", 1b.
   - Known gaps, for roadmap steps 3.3/3.4: a failing palette row is shown as a plain message
     (the result handler cannot return a `CommandResult`); a row whose object is gone can fall
     back to the route and select another object (no name in the item); modules call
     `getBridge()` directly instead of getting the bridge through `ModuleApi`.
2. Availability: the extension knows whether the script is installed, running and of a matching
   version (hello and installed-script check built, see 1); commands declare `requires` and
   answer with exit code 5 and a clear text. Built. Left: marking unavailable commands when the
   palette opens (cached state only; optional for 0.1.0).
3. Install and update for a user: `cmdabl setup` installs or updates the script, detects a
   version mismatch after an extension update and says when Live must be restarted. Open:
   `cmdabl --setup` installs today, but does not compare versions (0001 §7, step 7); the
   subcommand form is step 3.1.
4. Operations, in this order: `select` with read-back (built, see 1); track facts (built, see
   1; `arm` verifies through the script); chain nodes built (`bc46ca1`, `491e617`, script 0.4.0;
   `91f6c9b`, `1565a06`): kind "chain", path `/Track/Rack/Chain`, names from one `chains`
   request for all racks, cached; the tree build never waits; selecting uses `select`, so
   step 5 needs no new op. Behaviour changes: the first palette open after a start lists no
   chains yet (accepted); `find` also returns chains (new `-c`/`--chains`; `-t`/`-d`/`-c` now
   add up); `goto <name>` asks to pick when a track and a pad share a name; a renamed pad
   answers "the Live Set changed" or "is no longer there" until the cache refreshed.
   Unverified until the Live test (1d): selecting a Drum Rack pad. Still planned: Drum Rack chains
   and pads with their real names in the object tree, pad selection (`find vermona kick`);
   reading the current selection (for restoring it later in follow mode).
5. Unit tests for the protocol on both sides (built for steps 1–2); a Live test list per
   operation.

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

- Import-boundary test is built (`921dd43`, `9ee97c3`; rules in 0005, "Import boundaries"). One
  listed exception is left: `pakabl list` opening its own dialog (goes away with the `page`
  surface below).
- One shared matcher (approved by the user 2026-10-12): built — `src/core/match.ts`, embedded
  into the pages as `CmdMatch` (`f82ab56`); `find` (`ba229fc`), palette and pick list
  (`6f0527d`) use it. Path resolution stays strict. Behaviour change: the pick list filter
  matches words in any order and orders rows by fuzzy rank. The completion engine (0006, after
  0.1.0) builds on it. Live test: "Open Live tests", 1c.
- Feedback for `next`/`prev` (e.g. `2/5 /path`).
- A generic `page` surface on `Ui` for module pages (decided, see "Decisions"); `pakabl list`
  moves onto it and into the dialog queue.
- A larger maximum size for the pick list (0007).
- Clean "not supported on this platform" answers everywhere off macOS (`cmdabl --help` and `man`
  already answer exit code 5 with the URL off macOS; Windows untested).
- Note in `docs/sdk-tree.md` that `src/core/samePath.ts` is the first direct `node:fs` call in
  host code (fails soft). Live confirmed it works (the linked-Remote-Script line); the note is
  not written yet.

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
  and navigation mode. Open: do `next`/`prev` stay once follow mode exists? Kept until the spike.
  A timer for faster bridge replies becomes a candidate again with follow mode.
- 0007: theme file, replacement pages with fallback, `api.ui.register`; configurable dialog
  sizes.
- An index of the Ableton manual for `man ableton <words>` (wanted by the user, 2026-10-11)
  instead of a search-engine query: match the words against chapter and section titles
  (chapters are `/en/live-manual/12/<chapter>/#<section>`) and open the section, with the pick
  list on several hits (needs a pick list for things other than Live objects — a `ModuleApi`
  change).
- History as a log (user, 2026-10-11: wanted, but later): `history` shows the last commands
  newest first with success or failure, `Enter` runs a row again; failed commands are kept in
  the log too. Today the entries are only the first rows of the empty palette, marked
  `(history)` — at most 20, in memory only.
- Windows: an opener in core's `openUrl`, a trigger key, Remote Script install paths, a tester.
  (`man` and pakabl's Repo button are untested on Windows; `man` answers with the URL, exit 5.)

## Open Live tests

Everything not yet confirmed by the user. Restart `npm start` first. Passed (user, 2026-10-12):
`help` lists the commands, pick list for `goto`/`find`, `mute` multi-select with one undo, the
toggles incl. `arm` on audio/MIDI/return/main/group tracks.

1. Remote Script step 2 (first `cmdabl --setup`, restart Live, `npm start`). Seen 2026-10-12:
   `cmdabl --bridge` → 0.2.0 with `hello, select`; `goto` on a track, a device, a return track,
   the main track and a track in a folded group; "not running" without a pick list when the
   control surface is disabled; the first command right after `npm start` finds its track;
   `find`, `next`, `prev`; `goto` does not feel slower; a track row and a device row picked in
   the palette. Open: `cmdabl --help` lists `--bridge`;
   `curl http://127.0.0.1:27184/bridge` with a pick list and with a message open: answer, speed.
1b. Remote Script step 3, `arm` verify (`ebeadf7`, texts `3306ee8`). Seen 2026-10-12: `arm` on
   the MIDI track with the unavailable input device is reported (verify mismatch, decided on
   the second look); together with a normal track the normal one is armed. Open: the new
   message layout (`e975258`, `606e83e`; 0002): `arm` on a normal + the greyed-out track →
   "arm: 1 of 2 done", `✓` line first, `×` line with the reason on two indented lines, Close
   visible; `mute /a /nonexistent` → same layout; `find zzz` → one line as before; a normal
   MIDI and an audio track armed on/off several times never fail; Edit → Undo after a refused
   `arm` (what it shows, what one undo does).
1c. Shared matcher (`f82ab56`, `ba229fc`, `6f0527d`): palette — `mte`, `opal`, a path fragment
   give the same rows as before, flags still complete after a command name; pick list
   (`mute vermona`) — `midi vermona` and `vermona midi` find the same rows, marks survive
   filtering, no visible delay on open; `find vermona kick` as before.
1d. Chains and pads (script 0.4.0: `cmdabl --setup`, restart Live, `npm start`):
   `cmdabl --bridge` → 0.4.0 with `chains`; open the palette once, then `find vermona kick` →
   the Kick pad of the Drum Rack on "Vermona MIDI", selecting it shows the pad selected; the
   second palette open lists chain rows, picking one selects it; `find -c kick` only pads;
   `goto kick` with a track and a pad of that name asks to pick; `mute kick` offers only the
   track; rename a pad and use the old name → "the Live Set changed; run the command again",
   the new name works after the next palette open.
2. Hang diagnostics (`689e673`; the new log lines were seen by the user): with nothing open
   `POST /reset` answers "no
   dialog was open" and `GET /reset` 405; after the next real hang, before restarting: Undo in
   the Edit menu, Cmd+Z, switch apps, `POST /reset`, press `:`, report whether a palette appears
   plus the log from the last `run start:` line on.
3. History (`b09108c`, `972b67a`): `mute opal` with one match → history shows
   `mute "/Opal Lead"`, the re-run asks nothing; add a second "opal" track, re-run → still the
   first, no pick; `mute /Kick#1 kick`, pick Kick#1 → history `mute /Kick#1`; `goto vermona`,
   pick a device → the entry re-runs to the same device.
4. `mute /Opal Lead` (unquoted space) and `mute /a, /b` (comma form) still work.
5. Dashes (`d7ba529`, `fa31212`): track `Kick - Sub`: `mute /Kick - Sub` works, history shows it
   quoted; track `Bass -6dB`: `mute /Bass -6dB` → "unknown option" with the quoting hint,
   `mute "/Bass -6dB"` works; `find "-d"` is remembered as `find "-d"`; `mute -- --help` prints
   no help.
6. Pick list rows (`900f89d`): two tracks named `Kick`, `mute kick` shows `/Kick#1`, `/Kick#2`;
   a track named `a</script>b` does not break the pick list.
7. Pick list page (`1b305f6`, `d8ca020`, `bd13a52`; `Space` marking and the `> mute …` line seen):
   focus in the filter on open, typing works, size; `mute vermona`, type `vermona midi` → space
   appears, list filters, nothing marked; `↓` → hint `Space mark`, first row stays active,
   `Space` marks and moves on, `↑` from the filter only enters the list; in the list: stronger
   highlight, no caret, a typed letter / `Backspace` / `←`/`→` returns to the filter, marks stay;
   `Tab` marks in both zones, `Enter` runs on the marked tracks and the history entry equals
   the line, `Esc` cancels without history, a mouse click marks; `goto`/`find` (single-select):
   first `↓` moves to row two, `Space` types a space; a very long name stays on one clipped row;
   a pick with two rows has no scrollbar; sizing of a long list.
8. One dialog at a time (`6ad8884`; a trigger during a message opening nothing, and the log
   lines, were seen): `mute` on a missing track, dismiss, trigger → opens; `goto vermona` →
   pick → `Esc` → trigger → opens; `pakabl list` opens and its buttons work. If the palette
   sticks: look in the `npm start` log for `dialog open: X` without `dialog closed`, or
   `trigger ignored: a command is still running`.
9. pakabl (`504a606`, `9dc9ec7`, `82beafd`, `4a479ce`, `931615b`; `Install` seen): `pakabl update`
   → "index refreshed (16 extensions)", no note about ignored entries; `pakabl list` → Update,
   Uninstall, Repo (opens the extension's GitHub page) work; `pakabl install ../x` and
   `pakabl uninstall A.b` → "not a valid extension id", nothing on disk touched;
   `pakabl uninstall some.thing` → "not installed"; install then uninstall a real extension;
   `pakabl upgrade federico-pepe.snake@9.9.9` → version-mismatch failure.
10. `cmdabl --setup` unchanged (the linked line was seen right); unknown command shows
    `unknown command`; Karabiner `cmdabl_open` flag reset on startup (never reported).
11. `man` (`fcb7296`, `69452e9`, `0db7d6b`, `ddd15cb`, `e885674`, `9edd84f`; `man ableton`,
    `man cmdabl`, `cmdabl --help` seen; Ecosia opens and honours the path in `site:`):
    `man Ableton` (capital) → the Live manual; `man ableton warp modes` → results from manual
    version 12 only (untested narrowing), which language, is `/en/` the wanted one;
    `man ableton it's a & b` → words arrive intact; `man cmdabl foo` → "cmdabl has no search";
    a search entry in history re-runs; `man` → usage with topics; `man foo` →
    `no manual for "foo"` and topics; `man ableton extra` → usage error; `help` lists `man`; a
    successful `man ableton` is in history and re-runs; bare `cmdabl` shows the usage;
    `cmdabl --foo` adds `unknown flag`.
12. Messages and scrollbar (`1b6d254`, `b6b208a`, `5e6b339`, `ac885e2`, `158502d`, `63bba87`;
    `cmdabl --help` on six rows and the slim dim scrollbar in `pakabl list` seen): `help` → every
    line on one row, last line visible, no scrollbar; `Esc`/`Enter` close; `↓`/`PageDown` scroll
    a long text, Close stays visible; slim dim scrollbar in the message page and pick list; no
    white flash on open; palette dropdown, caret and selection still readable.
13. Not Live: the next pull request shows three checks (`build`, `gitleaks`, `docs-build`,
    `e23c043`); the next manual run of the pakabl index workflow proves the pinned
    `peter-evans/create-pull-request` (`a5e1adc`).

## Known issues and open questions

### Dialog hang

- Seen twice: after a `mute` (palette could not be opened until `npm start` was restarted;
  `/state` answered `open`, no window); and 2026-10-11, 20:59, after `arm` run twice on the group
  track "Analog Rytm": the next trigger logged `dialog open: palette` and nothing after it.
- Facts: `track.arm = v` is a synchronous native call in its own transaction; the SDK has no
  channel for a failure that arrives later. Our handler is synchronous and nothing drops a
  rejected promise. The log shows no `dialog failed` and no `trigger ignored`: the hang is inside
  `showModalDialog`, whose promise never settles. `arm` is a toggle (the two runs were arm, then
  unarm; the palette opened after the first); "no message" is the expected result of a write
  that does not throw and reads back equal. "A write to a group track" is **not** established as
  the cause; the shared factor of both hangs: a data-model write ran in the continuation of a
  dialog's close, and a later dialog request then hung.
- Hypotheses: (H1) group arm specifically; (H2) a transaction executed inside a modal's close
  callback overlaps the modal's teardown, timing dependent; (H3) unrelated to writes; (H4) Live
  holds the dialog because of a pending undo step.
- Experiment (user, 2026-10-11): `mute` through the pick list about ten times and by direct path
  about ten times: no hang. H2 is not supported (not excluded). The hang is rare and cannot be
  reproduced on demand, so neither candidate fix is shipped (run the handler one macrotask after
  a dialog closes; drop the outer `withinTransaction` for a single-track write). `arm` refuses
  group tracks before writing (`aa98b7a`, seen working) — it avoids one possible trigger only.
- After a hang (`689e673`): log lines `run start: <typed line>`, `run: <canonical line> ->
  <code|cancelled|threw> (<ms> ms)`, timed `dialog open/closed`. Check Undo in the Edit menu,
  Cmd+Z, switching apps; then `curl -X POST http://127.0.0.1:27184/reset` (local only, refuses
  requests with an `Origin` header, `GET` answers 405) and press `:`. `/reset` is temporary: on
  a healthy dialog it drops the result and the next trigger opens a second modal over the first;
  queued messages are lost; `pakabl list` opens outside the queue, so a hang there answers "no
  dialog was open". Test 2 in "Open Live tests".

### Other

- **`arm` on a MIDI track whose input device is missing** (arm button greyed out) shows no error.
  Measured in Live (2026-10-12, log lines of `ff32196`): the script reports `can_be_armed` true
  for it; the SDK reads back `arm` true after the write, but the script still reports `arm`
  false on the next run — Live does not arm the track and the SDK's value is wrong. So it can
  be detected: task out to cmdabl-modules — toggle from the script's value and verify with a
  second `track_facts` after the write (two requests for `arm`, an accepted exception to "one
  request per command"). Built in `ebeadf7` (reviewed); a mismatch is asked once more after
  100 ms before it counts. Without the script the limit stays. Live test 1b.
- Live's Log.txt shows a `SyntaxError` at startup for `import ableton-live-midi-remote-scripts`:
  a folder of that name in a Remote Scripts directory, not cmdAbl. Harmless; the user may
  remove or rename the folder.
- `cmdabl --bridge` took 2–3 s with nothing visible (user: looks like a hang). Task out to
  cmdabl-core: the command pings once and answers at once; the 20-round-trip measurement
  stays on `GET /bridge` only.
- **Exclusive Arm / Solo**: `arm /a /b` arms both tracks although "Exclusive: Arm" is on, and
  `solo` likewise with "Exclusive: Solo"; a write through the API does not apply the exclusive
  rule. Accepted by the user (2026-10-12); `arm /a` therefore does not disarm other tracks.
- **Host globals**: the Extension Host reports `URL`, `URLSearchParams`, `structuredClone`,
  `TextEncoder` and `crypto` as `undefined` (`fetch`, `AbortController` exist); in
  `docs/sdk-tree.md`, section 7. `openUrl` validates with a plain string check (`827f326`).
- **Undo History**: no call in the LOM documentation or the SDK types opens the panel (from the
  documents, not tried in Live). The idea is dropped unless Ableton adds one.
- **Windows**: untested (see "After 0.1.0").
- Known gaps of the bridge-based palette rows: see roadmap step 2, "Known gaps".

## Decisions

Decided by the user and still governing future work.

- 2026-10-11: 0.1.0 is macOS-only; the completion engine (0006) comes after it; the roadmap
  order was approved the same day.
- 2026-10-11: the Remote Script protocol as proposed in 0001. No `hello` reply → exit code 5 with
  what to do; the Live Set changed since the command was typed (route out of range, name
  differs) → exit code 1 "the Live Set changed; run the command again"; a faster drain than
  Live's display rate only if a measurement asks for it. The bridge sits behind an interface
  with a fake for tests; replies are validated where they arrive.
- 2026-10-11: no access token while the bridge operations only select and read — mandatory before
  the first operation that changes or deletes.
- 2026-10-11: Remote Script layout of 0001 §8 approved (`ops/`, `routes.py`; `bridgeOps.ts` with
  typed functions).
- 2026-10-11: keep a bridge round trip under 100 ms where possible (rule in 0001 §8).
- 2026-10-11: no timer for the faster drain for now; candidate again with follow mode.
- 2026-10-12: exclusive arm/solo is not applied by commands; naming several tracks is an explicit
  choice, like Cmd-clicking the buttons (accepted).
- 2026-10-11: `mute`/`solo`/`arm` toggle; `unmute`/`unsolo`/`unarm` switch off (0005).
- 2026-10-11: option (a) for module pages: a fourth generic surface `page` on `Ui`, reachable
  through `ModuleApi`; `pakabl list` keeps its page. Not built yet (roadmap step 4).
- 2026-10-11: the parser stays strict for dash-words in unquoted names (0005, "Dash rules").
- 2026-10-11: manual search uses Ecosia (`site:ableton.com/en/live-manual/12`) instead of
  DuckDuckGo.
- 2026-10-11: an index of the Ableton manual for `man ableton <words>` is wanted, after 0.1.0.
- 2026-10-11: history as a log is wanted, but later.
- 2026-10-11: the dialog hang must not ship as "only a restart helps" (roadmap step 1.2).

### Secrets (rule from the user, 2026-10-11)

No environment variable or secret may reach the git history. An API key is exported in every
shell on the user's machine. Agents do not print environments, refer to variables by name only,
and the reviewer checks every diff for secret-shaped strings. The architect scans the commits to
be pushed before every push. `.env*`, `.envrc`, `*.pem`, `*.key` are git-ignored. Scan of all
refs and the working tree on 2026-10-11: clean. Secret scan in CI (gitleaks, `1092e4e`): the full
history was scanned locally and on GitHub, no findings.

## Parked

- **`docs/sdk-tree.md` check**: approved earlier, then interrupted — update the header to name
  SDK 1.0.0-beta.1 and the vendored tarball, add `DataModelObject.handle`/`.parent`, and add
  `scripts/check-sdk-tree.ts` (names in the doc vs. the vendored type definitions, wired into CI).
- **pakabl index noise**: `candidates.json` stores star counts and push dates, so the daily
  workflow can open a PR when nothing relevant changed. Fix: only rewrite it when the set of repos
  or `.ablx` names changes.
- **First-party actions by tag**: `actions/*` are pinned by tag (`@v4`, …) in the four older
  workflows; pin them by SHA when convenient.
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
