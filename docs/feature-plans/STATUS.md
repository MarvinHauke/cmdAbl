# Status and next steps

The working state of the project: what is on which branch, what still needs a test in Live, and
what comes next. Maintained by the architect — update it whenever a task lands or priorities
change. Design decisions live in the numbered plans; this file only tracks progress. Finished
work is in the git history, not here.

_Last updated: 2026-10-20._

## Release 0.1.1 — open (branch `feat/tags-aliases`, version 0.1.1, not pushed)

Built and Live-tested: tags on tracks, `#tag`, `!#tag`, bare tag word, `--pick`. README landing
page, Requirements, Install, docs cleanup done (cmdabl-docs).

1. Live test `man <command>` (`76cb3ea`): `man tag`, `man history clear`, `man cmdabl` (site),
   `man cmdabl setup`, `man ableton warp modes`, `man tga` (did you mean), bare `man` (usage).
2. ~~Live test the new-tag row~~ — passed (user, 2026-10-20).
   Clickable link (user): "Open in browser" button on `man` pages (`2e2e41a`, `06267fa`,
   `bd1cfbf`) — Live test: `man history clear` / `man tag` button opens the section; Tab+Enter
   too; Esc/Enter/Close only close; `man tga` no button; `man cmdabl` opens the site.
3. Recordings by the user (`.mov` in `/tmp/shots/`) → cmdabl-docs makes GIFs:
   `hero` (tags in action), `tags` (tag list), `pakabl` (`pakabl list`); optional: Karabiner
   rule screenshot for Getting started. Then drop unused images (`demo.gif`, old `pakabl-list.png`).
4. Installed-build test: `npm run package`, install the `.ablx`, `cmdabl setup`, restart Live,
   `cmdabl bridge` shows 0.1.5, `tag` and `#fx` work.
5. Secret scan of the branch (counts only), `ssh-add`, push, PR "Release 0.1.1: tags" — on the
   user's go.
6. CI green → squash-merge (user's go) → release `v0.1.1`; hand-written notes (tags, `#`/`!#`,
   bare tag word, `--pick`, new-tag row, `man <command>`, run `cmdabl setup` once for script
   0.1.5, Cmd+Z does not undo tags).
7. pakabl index workflow → merge its PR; STATUS on `main`; delete the branch; 0.1.2 on a new branch.


## Where the code is

- `main`: contains the command platform rework since 2026-10-11 (PR #9 `refactor/core-modules`,
  squash-merged at the user's request). The Live test was not finished; the list below applies
  against `main`. The version is still 0.0.1, so the merge published no release.
- `feat/bridge-replies` (from `main`): pushed on 2026-10-12, draft PR #10; CI (`build` with
  the Remote Script tests, `gitleaks`, `docs-build`) is green. It holds roadmap step 2 and the
  forgiving target resolution; step 3 continues on it. The agents share one working tree, so
  all current work is on this branch. Merge when the user says so.
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

- **Installed build sandbox (found 2026-10-19, release blocker, in work):** the installed `.ablx`
  runs in a sandboxed Extension Host (Node `--permission`; reads only Ableton's `Extensions`,
  `Extensions Data` and its temp folder; writes only `Extensions Data` and temp; child
  processes allowed). The bridge token in `~/Library/Application Support/cmdAbl/` was
  unreadable → pad/chain mute/solo failed installed. Decided by the user: the script (0.1.2)
  writes the token to `Extensions Data/marvinhauke.cmdabl/bridge-token` (cmdabl-bridge).
  Also affected installed: reading the installed script's version, `samePath`. Live tests from
  now on also with the installed `.ablx`, not only `npm start`.

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
4. Operations — built and seen in Live: `select` with read-back, `track_facts` (`arm` verifies
   through the script), chain nodes with `chains`, `chain_set` for `mute`/`solo` with the
   access token, `showChains` for `--unfold`. Left: reading the current selection (for
   restoring it later in follow mode); chains of racks nested inside a chain.
5. Unit tests for the protocol on both sides (built for steps 1–2); a Live test list per
   operation.

### 3. Freeze the command syntax (cmdabl-core, cmdabl-modules) — the rest of 0005

Changing these after a release breaks what users have learned and what is stored in history.

1. `cmdabl` and `pakabl` as subcommand groups — built (`e04989d`, `f795ac1`, `7b158eb`):
   `cmdabl setup` (also says what to do about the Remote Script: restart Live, enable the
   control surface, or nothing), `cmdabl bridge`, `pakabl install|uninstall|update|upgrade|list`.
   No aliases (user, 2026-10-12): `cmdabl --setup` and `--bridge` are usage errors now, old
   history entries with them fail. `pakabl upgrade <id>` without a version installs the
   index's version only when it is newer (`8b03bca`, 2026-10-19: never an accidental downgrade;
   `<id>@x.y.z` still pins any index version). The legacy `registry.register` path and `ModuleApi.registry` are removed
   (`a3ae115`). Seen in Live (1g). Dead ends left until 0006: `FlagDef`/`PaletteItem.flags`, the
   flags fallback in `extension.ts`, the flag phase in `ui/interface.html`.
2. `enum` argument kind — built (`dbcb401`; `man <ableton|cmdabl>` in `32e04f9`): choices are
   checked when parsing (exit 2 with the list), usage shows `<a|b>`. pakabl ids stay plain text
   until a completion source exists.
3. Object rows of the palette run as `goto <unique path>` — built (`ee64867`, `9c6246c`,
   `1063875`): history entry, presenter, name check; a row whose object is gone never selects
   a neighbour. `registerResultHandler` is removed from `ModuleApi`. Note: `dbcb401` does not
   build on its own (a shared-index slip); irrelevant after a squash merge. Live test 1h.
4. Ports on `ModuleApi` — built (`ddc055d`, `2c98b8b`, `c5949a2`, `67655d5`, `1a33851`;
   confirmed by the user on the condition that the POSIX-like command contract stays):
   `bridge`, `liveSet`, `tracks` (SDK-backed), `log`, `dialog` (through the dialog queue).
   `api.context` is gone; an import rule keeps modules off the SDK and the bridge module;
   commands are tested at `run` level with fakes. Behaviour change: `pakabl list` waits in the
   dialog queue, and a page that fails to open counts as dismissed. Live test 1i.
4b. Live API mapping (approved by the user 2026-10-12; source for LOM names and paths:
   https://docs.cycling74.com/apiref/lom/): names follow the LOM; every Remote Script
   operation and every port records the LOM properties or SDK calls behind it and whether it
   runs through the SDK or the script — so when a later SDK covers more, only the adapter
   behind a port changes; `lomPath(node)`; a generated page "Live API mapping" checked in CI;
   a command that shows a target's LOM path. All for 0.1.0. After 0.1.0: reading or setting
   arbitrary LOM properties by command. Built: the LOM check against the reference, per-op
   LOM properties, `lomPath` (`0c05cda`); port ↔ SDK/LOM table and the generated page
   `docs/reference/live-api.md` (`79513e3`); `lom <target>` (commands page `8af6c1c`); names
   follow the LOM (`isFoldable`, `isShowingChains`, wire `is_showing_chains`, `in_note`;
   `ab4ae8b`, `2d0fdbc`, script 0.1.1). Live test 1j.
5. Leftovers — done: platform files moved into `src/core/` (`c536de6`; `src/` is now
   `ableton/`, `core/`, `modules/`, `extension.ts`, `httpTrigger.ts`), dead ends removed
   (`b6722ec`, `82c1e5b`: `FlagDef`, `flags`/`action`/`route`/`scope` on palette items, the flag
   phase of the palette page), import rule 6 for Node modules in `src/modules/` with
   `pakabl/platform.ts` as the listed exception (`50b2d9e`).

Step 3 is complete. Live smoke test: 1j plus `help`, `cmdabl setup`, a history row, an object row.

### 4. Small things that make it feel finished

- History commands (user, 2026-10-19; built `f113c9a`, `f6c6b37`, `a186f99`; Live test 14): `history clear` (asks, restorable),
  `history clear -f` (no question, not restorable), `history forget [-n N]`,
  `history restore [-n N]`; new `ModuleApi.confirm(message, confirmLabel)` for the question
  (shown as a two-row pick list, no `Ui` change). Owners: core (`confirm`), modules
  (`src/modules/history/`), docs (`using.md`).

- Import-boundary test is built (`921dd43`, `9ee97c3`; rules in 0005, "Import boundaries"). One
  listed exception is left: `pakabl list` opening its own dialog (goes away with the `page`
  surface below).
- One shared matcher (approved by the user 2026-10-12): built — `src/core/match.ts`, embedded
  into the pages as `CmdMatch` (`f82ab56`); `find` (`ba229fc`), palette and pick list
  (`6f0527d`) use it. Path resolution stays strict. Behaviour change: the pick list filter
  matches words in any order and orders rows by fuzzy rank. The completion engine (0006, after
  0.1.0) builds on it. Live test: "Open Live tests", 1c.
- Forgiving target resolution (approved by the user 2026-10-12): built (`461c885`, `46f241a`,
  `8588a8d`; rules in 0005, "Forgiving target resolution"). Behaviour changes: several bare
  words are one pattern first (`mute vermona kick` → the Kick pad); `mute <group> <its child>`
  asks instead of running both; two ambiguous texts share one pick list; a mistyped target
  opens a "did you mean" list instead of failing at once. Live test 1f.
- State symbols in the pick list of `mute`/`solo`/`arm`: which rows are already muted, soloed
  or armed (noted by the user 2026-10-12; draft in 0007 §4; two contract changes to confirm
  before building: a state field on pick list rows, a state reader on the command node).
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

Documentation (plan approved by the user 2026-10-12). Today the docs site has a 9-line home page
and three developer guides; nothing for users.

- **Generated command reference** (cmdabl-core): a script writes a page from the command tree;
  CI checks it is current. New optional fields on the command node, confirmed by the user:
  `description`, `examples`, and a summary per argument — the same texts show in `--help`. A
  test requires at least one example per command. Also generated: the list of Remote Script
  operations.
- Built: documentation fields and the generator (`845b971`, `3133603`, `8ba50b1`), the
  generated pages `docs/reference/commands.md` and `remote-script.md` with the CI check
  (`e616318`), "Getting started" and "Architecture" (`27a74c3`, `44399ed`), the authoring
  guide, "Using cmdAbl", "The Remote Script", "Known limits" (`6099aa7`, `4ebbac0`,
  `69075ed`). Open (cmdabl-docs has the briefs): Home, the README, the `node:fs` note, `tree`
  and the own-name rule in "Using cmdAbl"; three images from the user.
- **User pages** (cmdabl-docs, one brief per page from the architect): install and
  `cmdabl setup`; the Remote Script (what it does, restarting Live, the access token); using it
  (palette, pick list, several words, "did you mean", history); known limits (macOS-only, SDK
  beta).
- **"Adding a command"** (cmdabl-modules), after step 3.4.
- **README** shortened to a pointer to the site; stale passages out. The `node:fs` note in
  `docs/sdk-tree.md`.
- **Images:** only where they explain what text cannot. Dialog-only screenshots are generated
  by a script (cmdabl-ui, headless browser, sample data) into `docs/assets/`; shots with Live
  in them come from the user, from a short list with exact contents and file names. Private
  parts (home path, user name, project names) are covered with an opaque box rather than left
  out — never a blur. The architect looks at every image before it is committed.
- **`cmdabl-docs`**: a new on-demand agent (haiku; `scripts/agents.sh docs`,
  `.claude/agents/docs.md`) for `docs/` (not `feature-plans/`), `README.md`, `mkdocs.yml`,
  `docs/assets/`. If the writing quality does not hold, it moves to sonnet.

Release:

- From "Parked", what affects a release: the runner image before 2026-10-19, index pull requests
  that start the required checks, the pakabl index noise.
- Decide the temporary diagnostics on the trigger server: `POST /reset` and `GET /bridge` —
  remove, or keep `/reset` as a documented recovery.
- Release test: install the packaged `.ablx` into a Live without Developer Mode, run setup, run
  the full Live test list once.
- Bump the version in `package.json` and `manifest.json`, merge; the release workflow publishes.
- Release notes for 0.1.0 must say what changed for a user of 0.0.1 (its README documented
  them): `unmute`, `unsolo`, `unarm` removed — use `mute|solo|arm --set 0`; `cmdabl --setup` →
  `cmdabl setup`; the Remote Script is required for selecting; in a multi-select pick list `Enter` no longer
  takes the cursor row — mark rows with `Tab`/`Space` first; macOS only. The generated notes
  do not carry this; add it by hand to the release.

### After 0.1.0 (order to be set then)

- **Versions (user, 2026-10-19, conservative):** 0.1.1 tags on tracks · 0.1.2 the store +
  aliases, history survives restarts · 0.1.3 small items · more 0.1.x as needed · 0.2.0 a refined
  bundle (completion engine with ghost text and Telescope-style fuzzy finding, tags on chains
  and pads, pipes or refined aliases). Tags and aliases: plan 0008. 0.1.1 tags on tracks built on `feat/tags-aliases`
  (script 0.1.5 `c91a2c4`, core `2166db5`/`85ad442`, `tag` `9a77e00`; spike removed), waiting for
  its Live test; then acting on tags without a list and `--pick` (`85ad442`), `!#tag` (`bd2e3df`).
  Live-tested (user, 2026-10-20): `tag` toggle and list, tag pick list, `#tag`, bare tag word,
  `--pick`, `!#tag` (incl. comma/space lists, "every track is tagged", script off), history,
  save prompt via the colour step, save + reopen, Cmd+D copy (`/Lead#2`), return and main track,
  rename (tags stay with the track), non-ASCII name ("Drüms"), 64 tagged tracks (paged read).
  **0.1.1 fully Live-tested.**
  0.1.0 released 2026-10-19 (`a312c24`).
- From an outside review (ChatGPT, 2026-10-19), checked against the code: nothing is released on
  deactivate (trigger server, listeners) → fix in 0.1.x; `extension.ts` holds palette state
  next to the wiring → split later; a short note on what modules may rely on in `ModuleApi`.
  Done from it: the SDK packages left the public repo (license; private `cmdabl-vendor`, PR #11)
  and the unused Vite was removed.

- Ideas from ClyphX (2026-10-20): plan 0009 — `;` action lists with aliases (0.1.2); `.`,
  index, range and `all` targets, `vol`/`pan`/`send` (0.1.x); snapshots (0.2.x); triggers from
  clip, locator and pad names (spike after 0.2.0).

- `pakabl list --old-versions` (user, 2026-10-19): per extension a version choice from its
  GitHub releases; without the flag the newest release is offered. Needs the releases per
  extension (GitHub API via a child process, rate limits) or older versions in the index.

- Fuzzy finding after the user's target picture (Telescope "Find Files": subsequence match,
  highlighted characters, `/` anchors a path part, ranked rows with a counter) — 0006.

- Tell "not installed" from "not enabled" when the script does not answer in the installed
  build (read the installed version through a child process, e.g. `cat`; deferred 2026-10-19 —
  ddc2866 gives one honest text for both).

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

1. Remote Script and target resolution — **all seen by the user on 2026-10-12**: `select`
   (track, device, return, main, folded group, palette rows), `find`/`next`/`prev`, `arm`
   verify on the track with the unavailable input device and the new message layout, the shared
   matcher in palette and pick list, chains and pads (also of an Instrument Rack), `mute`/`solo`
   on pads (the mixer column's button changes and the pad's own M follows), `mute <track>
   <pad>` with undo (which steps the undo takes was not noted), `--unfold`, one pick list for
   several words (`mute sub vermona`), "did you mean" (`mute vermna`) and plain "nothing
   matches" (`mute zz`). Left from this block: `cmdabl --help` lists `--bridge`;
   `curl http://127.0.0.1:27184/bridge` with a pick list and with a message open; `goto kick`
   with a track and a pad of that name asks to pick; rename a pad and use the old name; token
   handling after disabling and re-enabling the control surface.
1g. Subcommand groups — seen by the user on 2026-10-12: `cmdabl --setup` → usage error with
   the valid subcommands, `cmdabl setup` with the advice line, `cmdabl bridge` (32 ms), `pakabl`
   help, `pakabl nolpe` → usage error, `pakabl list`. Not reported: the buttons of
   `pakabl list`, `pakabl install` without an id.
1h. Palette rows and `man`: pick a track, a device and a pad row → each is selected and the
   history shows `goto …`, re-runnable; with two same-named siblings the second row selects
   the second; control surface disabled → the row answers with the bridge's message; `man` and
   `man nope` → usage errors naming both topics; `man Ableton`, `man ableton warp modes`,
   `man cmdabl` as before.
1i. After the ports rework: `mute /a, /b`, `solo`, `unmute`, `unsolo` (one undo step each);
   `arm` on a normal track, a group and the MIDI track with the unavailable input; `mute
   <pad>` with the script on and off; `pakabl list` opens, its buttons work, `Esc` closes
   without a message; `goto`, `find kick`, `next`, `prev`, a palette row; `mute --help` shows
   description and examples.
1j. Script 0.1.1 and `lom` (`cmdabl setup`, restart Live, `npm start`): `cmdabl bridge` →
   0.1.1; `goto --unfold <rack track>` shows the chains; `find -c kick`, `mute <pad>`,
   `solo <chain>` as before; `arm` on a group is refused; `lom /<track>`, `lom` on a return
   track, the main track, a device, a rack, a pad → three lines (cmdAbl path, LOM path, link);
   one device path checked in Max for Live (`live.path`) → the same device; can the text of the
   message be selected and copied?; `lom` works with the control surface disabled.
1k. `--set`: `mute /a` toggles; `mute --set 1 /a, /b` with one already muted → both muted, no
   failure; `mute --set 0 /a, /b` → both unmuted; the same for `solo`, also on a pad; `arm
   --set 1` on a normal track, a group (refused) and the MIDI track with the unavailable input
   (reported); `mute --set 2 /a` → usage error naming 0 and 1; `unmute /a` → unknown command;
   run `mute --set 0 /a` from history → still unmuted.
1l. Round of 2026-10-13 — **seen by the user on 2026-10-13**: the own-name rule, joined words
   running at once, `find -L` (he first expected `-L 0` to mean tracks only; it means "objects
   whose own name matches", which includes a rack named like its track — kept), `Tab` fill,
   the palette `Enter` cases, `--set` and its history form. He reported "all other tests seem
   to work" without going through them one by one.
1m. State buttons, preview, Live colours and no preselection in `mute`/`solo`/`arm` — **seen by
   the user on 2026-10-19**. The rest of 1m is in the checklist below.
2. Hang diagnostics (`689e673`; the new log lines were seen by the user): with nothing open
   `POST /reset` answers "no
   dialog was open" and `GET /reset` 405; after the next real hang, before restarting: Undo in
   the Edit menu, Cmd+Z, switch apps, `POST /reset`, press `:`, report whether a palette appears
   plus the log from the last `run start:` line on.
Checklist of 2026-10-19 (replaces the old tests 3–12):

Tests 1–8 (pick list, names, history) — **seen by the user on 2026-10-19**; notes: without the
script, pad mutes answer "Remote Script not running" (intended); `goto` makes no Live undo
entry (selecting is not undoable in Live).

Tests 9–17 — **seen by the user on 2026-10-19** (dialogs, `help`, `pakabl update`/`list`/
`uninstall`, `man ableton warp modes`, `man foo` → "invalid value … choose one of ableton,
cmdabl", `unmute x` → unknown command), plus `find kick`, `lom /Kick`, `arm` on a group
refused. `goto kick` runs the track `/Kick` at once (a bare word equal to a top-level track name
is that track, 0005) — the expectation "asks to pick" was wrong.

Installed `.ablx` with script 0.1.2 (`97b4e27`, `ddc2866`, `6f8ea68`): pad states and
pad mute read again; control surface off → the new "not running" text, back on → works
without restarting Live — **all seen by the user on 2026-10-19**. Polish in work: the same
failure reason once for several targets (core).

Seen 2026-10-19: `mute --set 2` → usage error. Also seen 2026-10-19: `pakabl list` Install and Repo; a renamed pad's old name → "did you
mean" (text similarity only, no LOM id); `lom` on a pad with the control surface off. Nothing
left before the release test.

History commands — **seen by the user on 2026-10-19** (restore, forget, `clear -f`,
    "nothing to restore"; the question of plain `clear` not in the screenshots): `mute bass`, `solo lead`, then `history clear` → question with Cancel
    first; Cancel → "history kept"; Clear → no history rows; `history restore` → both back in
    order; `history forget` drops the newest, `history restore -n 1` brings it back;
    `history clear -f` asks nothing, then `history restore` → "nothing to restore"; no
    `history …` line ever appears as a history row.
Not Live: the next pull request shows three checks (`build`, `gitleaks`, `docs-build`,
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

- Live's undo list names each cmdAbl change after the property ("Change \"Speaker On\"" for a
  mute). The SDK's `withinTransaction(fn)` takes no name and the LOM has no named undo steps, so
  cmdAbl cannot label them. Candidate feature request to Ableton: a name for an undo step.

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
- **pakabl and the sandbox** (user, 2026-10-12): pakabl installs Ableton Live extensions
  (`.ablx`) by writing into Live's Extensions folder from the Extension Host. It works today; a
  stricter sandbox announced by Ableton may block installing in a later Live. Documented as a
  limit. Its texts said "cmdAbl extensions" — being corrected to "Ableton Live extensions".
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
- 2026-10-12: `mute` and `solo` shall also work on rack chains and Drum Rack pads in 0.1.0
  (`mute kick` → the pad); `arm` stays tracks-only. The SDK cannot write a chain's mute/solo,
  so the script gets a writing operation `chain_set` (0001 §9). Confirmed by the user: the
  access token (new per Live start, in `~/Library/Application Support/cmdAbl/bridge-token`,
  outside the repo, never logged; writing operations are refused without it, reads and
  `select` need none); always the chain's own switch, for every rack type (whether a Drum
  Rack pad's M button follows is checked in Live). The reference is the chain's column in
  the Session mixer (speaker button and S). Script side built (`5a63bd4`, script 0.5.0:
  `chain_set`, the token, `chainSwitches`/`chainSet` in `bridgeOps.ts`; the token path is
  outside the repo in every setup and nothing prints it). Commands built (`8cf77a2`): tracks
  through the SDK as before, chains through the script; exit 5 only when every target failed
  with 5. Live test 1e. Seen in Live meanwhile: `find test chain` finds the Instrument Rack's chain
  (fix `54c1182`).
- 2026-10-12: selecting a pad or chain does not unfold the track's chains in the mixer — the
  user wants that as the default, plus an option `--unfold` on `goto`/`find` that shows them.
  Built on the LOM's documented `Track.is_showing_chains` (unverified in Live): `showChains`
  on `select` (`7ee66a8`), the flag on `goto`/`find`, kept by `next`/`prev` (`957d78c`). Side effect: Live saves the fold state
  with the Set, so the Set counts as modified. Opt-in only; never folds.
  Seen in Live: it unfolds; Undo does not fold again (view state). There is no command to
  fold the chains back yet.
- 2026-10-12: renamed commands get no alias for the old spelling before 0.1.0 (the user is the
  only user so far); removing `registerResultHandler` from `ModuleApi` is confirmed.
- 2026-10-13: the "own name" rule — a command's text target must have at least one typed word
  in the object's own name, the others may match its parents (`60a1dc2`). `find` keeps "anywhere
  in the path" on purpose. Words typed together: if they hit as one pattern, that is the
  reading — one hit runs, several open a pick list with those hits only; a comma names several
  targets. (The user first chose "keep asking when two readings are possible", then corrected
  it after the Live test: `mute vermona kick` must not ask when one pad matches.) Built
  (`daf16e9`), with the remembered line showing `--set 0` instead of `--set=0`.
- 2026-10-13: `tree` (built the same day, `9730198`) is removed again — fewer base commands.
  Its use moves into `find -L, --level <n>`: how far below the object whose own name matches
  the results go (`-L 0` = only that object); `find` without a pattern is allowed with `-L` or
  a kind flag. Built (`5437203`).
- 2026-10-13: in a single-select pick list (`find`'s), `Tab` puts the chosen object's path into
  the palette for a follow-up command; `Enter` runs as before. Needs two additions to the `Ui`
  contract (a "fill" outcome of `select`, an initial text for `prompt`; 0007 §4). Built
  (`ac821a6`, `797b38d`): completing a command in the refilled palette keeps the path.
  Later, with pipes: the caret may be better at the end of the filled text (user's note).
- 2026-10-13: the dialog hang is accepted as a known issue for 0.1.0 (not seen again; cause
  unknown; everything is beta). `POST /reset` stays as the documented recovery
  (`docs/limits.md`); no watchdog for now. Roadmap step 1.2/1.3 is closed with that.
- 2026-10-13: small items for 0.1.0, built: state symbols in the pick list (contract in 0007
  §4 and 0005; `e852014`, `99e290a`, `2b62570`) and a larger pick list (`99e290a`). Feedback for `next`/`prev` is
  dropped for now — a message after every step would have to be dismissed. `pakabl list`
  already goes through the dialog queue since step 3.4 (`67655d5`), so the `page` item is done.
- 2026-10-12: Remote Script versions grow conservatively. Reset to 0.1.0 (`2b2d448`; it had
  gone to 0.6.0 in a day). Every script change raises the third number, also during
  development; the middle number only with a release whose script is incompatible with the
  previous release's extension. Compatibility is decided by the operation list, versions are
  compared for equality only (0001 §3).
- 2026-10-12: exclusive arm/solo is not applied by commands; naming several tracks is an explicit
  choice, like Cmd-clicking the buttons (accepted).
- 2026-10-12: `mute`/`solo`/`arm` toggle by default and take `-s, --set <0|1>` to force the
  state (1 = muted / soloed / armed, as in the LOM); `unmute`/`unsolo`/`unarm` are removed, no
  aliases — fewer base commands. Replaces the decision of 2026-10-11 to keep the `un…`
  commands. Built (`6af692b`, `8fa17a9`). Live test 1k.
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
