# Status and next steps

The working state of the project: what is on which branch, what still needs a test in Live, and
what comes next. Maintained by the architect — update it whenever a task lands or priorities
change. Design decisions live in the numbered plans; this file only tracks progress.

_Last updated: 2026-10-11._

## Where the code is

- `main`: SDK 1.0.0-beta.1, pakabl index crawler, CI, guides, MkDocs site, plans 0004–0006.
- `refactor/core-modules` (draft PR #9, CI green): everything below under "Built, not yet merged".
  Merge after the Live test passes.
- `docs/sdk-tree-check` (local only, no changes yet): parked task, see "Parked".
- PR #8 `pakabl/index-update` (opened by the daily crawler, not reviewed yet): check the diff —
  if only star counts or push dates in `candidates.json` changed, it is the known noise (see "Parked").

## Built, not yet merged (PR #9)

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

### Live test list for PR #9 (restart `npm start` first)

1. `help` lists the commands, including `goto`, `find`, `arm`.
2. `goto vermona` → pick list; `Enter` selects; `Esc` does nothing and adds no history entry.
3. `mute vermona` → pick list; mark two with `Tab`; `Enter` flips both; one undo reverts both.
4. Toggles (`145fd98`):
   - `solo /x` twice → on, then off.
   - `mute a b` with one already muted → both flip; one undo reverts both.
   - `mute /a /a` → flips once.
   - `unsolo /x` on a track that is not soloed → nothing changes; same for `unmute`.
   - `arm` on a return or the main track → a failure message, no crash.
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
    - `cmdabl --setup` → same output as before (symlink created or "already exists").
    - `:` opens the palette, and types a colon while the palette is open.
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
    - `man ableton` → the Live manual opens, no message; `man Ableton` → the same.
    - `man cmdabl` → the docs site.
    - `man` → usage with the topics; `man foo` → `no manual for "foo"` and the topics;
      `man ableton extra` → a usage error.
    - `help` lists `man`; a successful `man ableton` is in the history and re-runs.
    - `cmdabl --help` and bare `cmdabl` show the usage text; `cmdabl --foo` adds `unknown flag`.

### Found in the Live test (2026-10-11, still running)

- Passed so far: `help`, pick list for `goto` and `find`, `find -t`, `next`/`prev`, `pakabl list`.
- The `help` window is too small (text wraps at 500×180) — see "Dialog size" in 0007.
- Open decision: do `next`/`prev` stay once the pick list has a follow mode? Kept until the spike.
- **Palette stuck "open"**: after some tests (last command probably `mute`) the palette could not
  be opened until `npm start` was restarted; `/state` answered `open`, no window was visible, no
  log captured. Suspected, unverified: a message dialog (`notify`, not covered by `isOpen`) was
  still up when the palette was triggered. Task out to cmdabl-core: one dialog at a time, "open"
  covers messages, log lines for open/close. **The cause stays unverified after that lands**: the
  queue does not help if a dialog promise never settles; the new log lines are there to tell.
- **`pakabl list` opens its dialog itself** (`src/modules/pakabl/index.ts`), outside the `Ui`
  contract and the dialog queue. No collision today. Options: (a) a fourth generic surface
  (`page`) on `Ui`, reachable through `ModuleApi`; (b) rebuild the list on `select` plus
  commands. Both change a contract — **waiting for the user's decision**.
- `pakabl list` inlined downloaded index data unescaped (`</script>` in a name breaks the page).
  Task out to cmdabl-modules, using core's `inlineJson`.
- `Space` "did not mark" in the pick list: resolved, not a bug. The user had used `find`, which is
  single-select; with `mute` marking and the command line work in Live.
- The first `↓` skipping the first row felt odd. Changed in `d8ca020`: in a multi-select pick the
  first arrow only enters the list.

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
| Secret scan in CI (`.github/workflows/secret-scan.yml`, gitleaks 8.30.1 pinned by checksum, `docs/guides/ci.md`) | cmdabl-core | committed `1092e4e`, reviewed. Full history scanned locally: 0 findings. **Only the first CI run after a push shows whether the workflow works** — then check the push run and start one manual run |
| Pin `peter-evans/create-pull-request` in `pakabl-index.yml` to a commit SHA | cmdabl-core | committed `a5e1adc` (v7.0.11), reviewed; the next manual run of the index workflow after a push is the check |
| `cmdabl --help` prints usage instead of opening the Ableton manual; `openUrl` in its own file | cmdabl-core | committed `fcb7296`, reviewed. The usage text points to `man cmdabl` — **do not push before the `man` module is in**. Live: `cmdabl --help` and bare `cmdabl` show the usage, `cmdabl --foo` adds `unknown flag`, `cmdabl --setup` unchanged |
| New module `man`: `man ableton` (Live manual), `man cmdabl` (docs site) | cmdabl-modules | committed `69452e9`, reviewed; needs the Live test (step 16). On Windows `man` answers with the URL (exit 5) until core's `openUrl` has a Windows opener |
| pakabl's Repo button opens through core's `openUrl` (macOS); the Windows branch stays, with an https check | cmdabl-modules | committed `931615b`, reviewed; Windows untested |

### Candidates (not ordered yet — order them with the user after the test)

- Follow mode for the pick list (0007 §4; needs the spike in 0006).
- Dialog sizes: `notify` sized from its text, larger pick list, configurable sizes (0007).
- A `history` command: show the list and re-run an entry. Today the entries are only the first
  rows of the empty palette, marked `(history)` — at most 20, in memory only.
- Feedback for `next`/`prev` (e.g. `2/5 /path`).
- Object items in the palette routed through `goto` (0005).
- An `enum` argument kind with declared choices (0005 mentions it for pakabl ids): `man` would
  then show `usage: man <ableton|cmdabl>` instead of `man [topic]`, and get completion.
- A Windows opener in core's `openUrl` (`man` and `cmdabl` answer with the URL there today;
  pakabl keeps its own `Start-Process` branch until then).
- Search in the Ableton manual: `man ableton <words>`. The online manual has no search of its own
  (checked 2026-10-11; chapters are `/en/live-manual/12/<chapter>/#<section>`). Options: (a) open
  a web search limited to the manual; (b) ship an index of chapter and section titles, match the
  words against it and open the section, with the pick list on several hits (needs a pick list
  for things other than Live objects — a `ModuleApi` change). Waiting for the user's choice.

Decided by the user: the parser stays strict for dash-words in unquoted names (0005, "Dash rules").

### Secrets (rule from the user, 2026-10-11)

No environment variable or secret may reach the git history. An API key is exported in every
shell on the user's machine. Agents do not print environments, refer to variables by name only,
and the reviewer checks every diff for secret-shaped strings. The architect scans the commits to
be pushed before every push. `.env*`, `.envrc`, `*.pem`, `*.key` are git-ignored. Scan of all
refs and the working tree on 2026-10-11: clean.

## Next, in order

1. **Live test of PR #9**, fix what it shows, merge.
2. **Remote Script with replies + Drum Rack pads** (cmdabl-bridge). The user searched for
   `find vermona kick`: the pads ("Kick", "Snare", …) are chains of a Drum Rack, which are not in
   the object tree — the SDK exposes chains and their MIDI note but not their names. Recommended
   and presented to the user, not yet explicitly confirmed: request/response protocol (`hello`
   with version and op list, request ids, timeout), chains in the tree with real names, pad
   selection, `select {route, expectName}` read-back. Plans: 0001 Phase 4, decisions in 0004.
3. **Keymap** (cmdabl-core + cmdabl-ui): UI keys as named actions, defaults plus a user
   `keymap.json`, keys bindable to command lines. Described in 0006.
4. **Dialog-channel spike** — decides two features, navigation mode and the pick list's follow
   mode: can the dialog page `fetch` the local server, does the Remote Script process messages
   while a modal is open, does Live repaint behind it? Then build, or fall back to global hotkeys
   via Karabiner/AutoHotkey. The four checks are listed in 0006.
5. **Rest of 0005**: ports instead of the raw `ModuleApi` context, `requires: ["bridge"]` checks,
   `pakabl` and `cmdabl` as subcommand groups (`cmdabl setup`, old flag as alias), the
   command-authoring guide (`docs/guides/adding-a-command.md`).
6. **0007**: theme file, replacement pages with fallback, `api.ui.register`.
7. **0006**: tree-driven completion in the palette (ghost text, level-by-level paths).

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
- **CI runner image**: `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19; the crawler needs `unzip`.
  Pin `ubuntu-24.04` in the workflows or verify after the switch.
- **Old remote branches** `features` and `feature/path-addressed-objects`: the user has not decided
  whether to delete them.

## Deferred on purpose

Typed pipelines (`find … | mute`), macro recording, an adapter for external programs, loading
third-party modules at runtime (blocked by the SDK). Reasons and triggers are in 0004.
