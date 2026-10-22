# Status and next steps

The working state of the project: what is released, what is in work, what still needs a test, and
known issues. Maintained by the architect. The order of the next features and how they build on
each other is in the [plan index](README.md#next-in-dependency-order); design decisions live in the
numbered plans. Finished work is in the git history, not here.

_Last updated: 2026-10-22 (cleanup after 0.1.3)._

## Released

| Version | Date | What | PR |
|---|---|---|---|
| 0.1.0 | 2026-10-19 | Two-way Remote Script bridge, chains and pads, forgiving target resolution | `a312c24` |
| 0.1.1 | 2026-10-21 | Tags on tracks (`#tag`, `!#tag`, `--pick`), `man <command>`; script 0.1.5 | #13 |
| 0.1.2 | 2026-10-21 | Tag board, `tag -e`, `tag -r`, `cmdabl log`, nested racks; script 0.1.6 | #14 |
| 0.1.3 | 2026-10-22 | `vol`, `note`, agent test access (dev builds); script 0.1.8 | #17 |

All releases were tested in Live, including the installed `.ablx`.

## Now

- `main` is current and protected (ruleset "Protect main": PR required, checks `build` and
  `gitleaks`, no force push). The private mirror's `main` follows it.
- Built, Live-tested through MCP (2026-10-22): argument completion (plan 0006 steps 1–2, 0.1.4,
  branch `feat/completion`). Snapshot at palette open: 3 ms warm, about 220 ms on the first open of a
  session (cold tag cache). Plus the palette switch "Above the prompt: Off · Hints · Options"
  (`palette.above` in `settings.json`, the first piece of the store), Live-tested. Docs and images
  done. Next: release 0.1.4, then plan 0017 (scripts and triggers) first.
- How testing works since 0.1.3: the architect runs Live test lists through the `cmdabl_*` MCP tools
  (plan 0016) once the user has started `npm start` with a test Set; the user gets a short list of
  the core features to try by hand (`CLAUDE.md`, "Agent team").
- Docs: every change brings its docs; before each release, cmdabl-docs reads the touched pages as a
  whole and the reviewer checks the facts (`docs/guides/release-cmdabl.md`).

## Small items

- `find !#x` and `mute !#x` word "every track is tagged #x" differently.
- A pad with one same-named device shows twice in `find` (collapse proposed, undecided).
- Pick lists and `find -d` list devices inside chains (no filter yet).
- Palette rows don't refresh chain names first; suggestions can lag a few seconds after a rack change.
- `cmdabl_keys`: another small Live window on top (a plug-in window, Settings) passes the "dialog in
  front" check (plan 0016 risks).
- `man <command> <sub>` completes top-level names again (completion doesn't follow subcommands yet).
- A file-stat port in core would remove pakabl's `node:fs` and `node:child_process` exceptions
  (core/modules boundary, undecided).
- Nothing is released on deactivate (trigger server, listeners); `extension.ts` holds palette state
  next to the wiring (outside review, 2026-10-19).

## Untested leftovers

Older checks that were never reported; most can now run through MCP.
- Token handling after disabling and re-enabling the control surface.
- `pakabl install` without an id; plain `history clear` (the question).
- The dialog-hang diagnostics: after the next real hang, before restarting, `POST /reset`, then `:`,
  and the log from the last `run start:` line.
- Optional: a board section taller than the view; 64 tracks with `vol`.

## Backlog (not ordered)

- Device on/off (user, 2026-10-22): its own module `bypass` with the short alias `bp` (command aliases
  exist in the tree). It switches a device's "Device On" (SDK `parameters[0]`, no Remote Script). Rules as
  `mute`: toggle, `--set 1` bypassed, `--set 0` active, several targets, pick list with state, one undo
  step. Devices only (a track gives a clear message); completion offers only devices. Not part of `mute`:
  mute silences a path (track, chain, pad), bypass skips a device's processing. Deferred until the `mute`
  listing has a hierarchy (plan 0006 step 3); order set by the user.

- A `cmdabl settings` page (user, 2026-10-22): one place for cmdAbl's settings (`settings.json`); the
  palette's "above the prompt" switch likely moves there. Builds on the store from 0.1.4 (plan 0008).

- Ideas from ClyphX (2026-10-20): plan 0009 — `;` action lists with aliases (0.1.3); `.`,
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
- **Windows**: untested (see "Backlog").

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
- **Old remote branches** `features` and `feature/path-addressed-objects`: the user has not decided
  whether to delete them.

## Deferred on purpose

Typed pipelines (`find … | mute`), macro recording, an adapter for external programs, loading
third-party modules at runtime (blocked by the SDK). Reasons and triggers are in 0004.
