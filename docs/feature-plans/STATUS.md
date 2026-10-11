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

### Found in the Live test (2026-10-11, still running)

- Passed so far: `help`, pick list for `goto` and `find`, `find -t`, `next`/`prev`, `pakabl list`.
- The `help` window is too small (text wraps at 500×180) — see "Dialog size" in 0007.
- Open decision: do `next`/`prev` stay once the pick list has a follow mode? Kept until the spike.
- **Palette stuck "open"**: after some tests (last command probably `mute`) the palette could not
  be opened until `npm start` was restarted; `/state` answered `open`, no window was visible, no
  log captured. Suspected, unverified: a message dialog (`notify`, not covered by `isOpen`) was
  still up when the palette was triggered. Task out to cmdabl-core: one dialog at a time, "open"
  covers messages, log lines for open/close.

### In progress (tasks out, 2026-10-11)

| Task | Agent | State |
|---|---|---|
| `mute`/`solo`/`arm` toggle again; `un…` stay as "off" (0005) | cmdabl-modules | committed `145fd98` + `083c288`, reviewed; needs the Live test (step 4 above) |
| `SelectRequest.preview` and `items[].value` for the command line in the pick list (0007 §4) | cmdabl-core | committed `900f89d`, reviewed (also escapes `<` in the data inlined into all three dialogs); the line itself is not visible until the page task is done |
| Remembered line fully canonical: unique paths, each object once (0005) | cmdabl-core | committed `b09108c` + `972b67a` (option parsing fix, reviewed OK). `b09108c` alone has one failing test — squash before merging if a clean history matters |
| Dash handling: quote leading-dash words in the remembered line, `--` ends options, lone `-` is a word, hint in "unknown option" (0005) | cmdabl-core | committed `d7ba529` + `fa31212`, reviewed; needs the Live test (step 11 above) |
| Pick list page: two zones (`Space` marks in the list), command line (0007 §4) | cmdabl-ui | waiting — the user starts it with `scripts/agents.sh ui`; needs the core task first |

### Candidates (not ordered yet — order them with the user after the test)

- Follow mode for the pick list (0007 §4; needs the spike in 0006).
- Dialog sizes: `notify` sized from its text, larger pick list, configurable sizes (0007).
- A `history` command: show the list and re-run an entry. Today the entries are only the first
  rows of the empty palette, marked `(history)` — at most 20, in memory only.
- Feedback for `next`/`prev` (e.g. `2/5 /path`).
- Object items in the palette routed through `goto` (0005).
- Unquoted names with a dash-word (`mute /Bass -6dB`): stay strict, or let path arguments take
  them? Strict for now (0005, "Dash rules") — the user should weigh in.

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
- **CI runner image**: `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19; the crawler needs `unzip`.
  Pin `ubuntu-24.04` in the workflows or verify after the switch.
- **Old remote branches** `features` and `feature/path-addressed-objects`: the user has not decided
  whether to delete them.

## Deferred on purpose

Typed pipelines (`find … | mute`), macro recording, an adapter for external programs, loading
third-party modules at runtime (blocked by the SDK). Reasons and triggers are in 0004.
