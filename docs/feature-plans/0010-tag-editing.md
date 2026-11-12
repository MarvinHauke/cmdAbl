# Tag editing: an interactive overview and one tag on many tracks

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0008](0008-tags-and-aliases.md) (tags on tracks, `tag -l`),
[0007](0007-ui-surfaces.md) (a new surface `board`).

**Status:** Released in 0.1.2 (board, `tag -e`, `tag -r`); board editing released in 0.1.5 (2026-11-05,
PR #27): rename and remove whole tags, click to assign, the file-tree keys. Open: the 0.1.6 settings
and help pattern (gear button, `tag config`, footer help on hover; released in 0.1.6). In work for 0.1.8 (branch
`feat/0.1.8-tag-editor`): the tag list and tag editor (tag-0, below; "Build" for the contract).

## Context

`tag -l` (0.1.1) shows each tag with the tracks that carry it. It is a read-only `notify` page
built from `CommandResult.sections`. In the Live test the user asked for two things:

- removing a tag from a track by clicking the track's label in that overview;
- assigning one tag to many tracks at once.

A dialog cannot call the extension while it is open. It answers once, when it closes. Editing
therefore follows the pick-list rule that Live changes only on confirm: the page collects the
changes, the extension applies them after the dialog closes.

## Decisions (user, 2026-10-20)

1. **The overview collects, then applies.**
   - A click on a track label in `tag -l` marks it for removal; the label is struck through, and a
     second click unmarks it.
   - The footer shows `Apply (N changes)` and `Close`.
   - Apply closes the page with the change set. The module writes it with the existing
     `planTags` and `tags_set` (one write per track); the board stays closed.
   - Close, or Esc, changes nothing.
   - The result message lists the changes and the `undo:` lines, as `tag` does today.
2. **Assign in the same window, like the tag bar in Live's browser** (user, 2026-10-20): each tag
   in the overview has an `add…` input that suggests tracks (first built as a checkbox list,
   replaced after the first look in Live). No second dialog.
3. **A generic core surface `board`, not a module page.**
   - The contract goes in `src/core/surfaces/ui.ts`, the page is `ui/board.html` and uses `shared.css`.
   - It can be themed and replaced like the other surfaces (0007 §2).
   - Later users: aliases, the history list, tags on chains and pads.
4. **After Apply the board stays closed, quietly** (user, after the Live test, 2026-10-20 —
   reopening felt strange; first built as a reopen loop). The changes and `undo:` lines go to the
   log (`CommandResult.log`, [0011](0011-logging.md)); only failures show a dialog. Close or Esc
   changes nothing and shows no message.
5. **`tag --edit <tag>` (`-e`) ships with it** as the keyboard path (name decided by the
   architect: the user already calls it that).
6. **An "untagged" section** lists the tracks without any tag, read-only (chips without ×, no
   input) — adding a track to a tag is how it leaves it. Contract: a section has
   `readonly?: true`.
7. **Module pages move to `ui/modules/<module>/`** (user, 2026-10-20): `ui/pakabl-list.html`
   becomes `ui/modules/pakabl/list.html`; the architecture test allows a module only its own
   folder there (cmdabl-core).
8. **`tag --rename <old> <new>` (`-r`)** (user, 2026-10-21; built core `4033470`, modules `8134f55`) renames a tag on every track that carries it.
   - Both values come after the option, because the first positional is the resolved target path.
     This needs a core addition: an option that takes two values. That is a change to the command
     node format, approved by the user.
   - `old` must be a known tag, otherwise exit 3 "no track is tagged #old". `new` follows the tag
     grammar and is lowercased; a leading `#` is accepted on both.
   - If `new` exists already, the two tags merge: a track that had both keeps one.
   - The write is one `tags_set` per track and is quiet. The change and `undo:` lines go to the
     log (0011).
   - Combined with a target, names, `--list`, `--set` or `--edit`: exit 2. Script off: exit 5.

## Design (draft)

Modelled on the tag bar in Live's browser (user, 2026-10-20): chips with × and an "Add…" input.

### What the overview looks like

Revised after the first look in Live (user, 2026-10-20): an inline input per tag instead of a
checkbox list — like the "Add…" field of the tag bar in Live's browser; less clutter, the tracks
are not listed until you type.

```
#drums                                         5 tracks
  [/Synth ×] [/Bass ×] [/Lead ×] [/Drums ×] [ add…      ]
#lead                                          1 track
  [/Lead ×] [ gu|itar          ]          ← ghost text
            [/Guitar] [/Gun Synth]        ← up to 6 suggestions
untagged                                       4 tracks
  /Drums  /A-Delay  /B-Reverb  /C-Corpus
[ new tag…  ]
                                 [Apply (1 change)] [Close]
```

- **Chips:** each tag lists its tracks as chips; × (or a click) marks one for removal (struck
  through; again unmarks).
- **`add…` input** as the last chip: typing suggests the tracks that do not carry the tag
  (substring, start of name first) — the best one as ghost text, up to 6 as suggestion chips.
  Tab in a non-empty input puts the highlighted suggestion into the input and stays there (Tab in
  an empty input moves to the next field; user, Live test), Enter adds the best or highlighted suggestion (a chip with a dashed ring), a
  click on a suggestion adds it. Backspace in an empty input marks the last chip for removal. ← in an empty input (or with the caret
  at the start) moves a chip cursor onto the chips; ←/→ step through them, Backspace/Delete/Space
  toggle the mark of the chip under the cursor, → past the last chip or typing returns to the input
  (user, Live test).
- **↑/↓** move the highlight through the suggestions while they show, otherwise to the previous or
  next tag's input. **The suggestion row is a selection**: → from the end of the field enters it on
  the highlighted suggestion (shown filled); ←/→ walk it (→ on the last stays); ← on the first goes
  back to the field (caret at the end); a typed character or Backspace goes back and edits the text;
  Esc leaves the row (a second Esc clears the field); Enter adds (in the field and in the row the typed text and the list stay, the added track leaves the list and the highlight moves on, so several similar names go in a row; an empty list returns to the field with the text kept; Esc clears); Tab completes the text with the highlighted suggestion (shell-style), returns to the field
  with the caret at the end and the suggestions update for the new text. →
  into the chips only applies while no suggestions show. **Enter applies whenever there is nothing to add** (user decision 2026-11-05, against the Live test of 2026-10-20: after adding from the field the typed text stays, so "type, Enter adds, Enter applies" is now "type, Enter adds, Esc clears, Enter applies"; decided: when the added label equals what was typed (case-insensitive, with or without the leading /) the field clears, so the next Enter applies as before): in an empty input, an empty "new tag…" or on
  the chip cursor, if its field is empty (user, Live test 2026-10-20; `f8e4135`). **Esc** clears the input, then closes.
- **`new tag…` input** at the bottom: Enter checks the name and adds an empty section with the
  focus in its `add…` input. A tag with no track added is not kept. A name that already exists (ignoring case
  and a leading #) is refused on the page ("exists already"); the module's lowercase-and-merge stays
  as a safety net.
- **Apply (N changes)** sends the change set; Close or Esc discards it.
- **Esc or Close with pending changes** warns once ("N changes not applied — Esc again to
  discard"); the second discards (architect, 2026-10-20).
- The page does not draw `title` (the dialog already names the command); it stays in the
  request for replacement pages.
- The contract is unchanged; only `ui/board.html` changes.

### The `board` surface (contract addition, cmdabl-core)

A generic "groups × entries with on/off" editor:

```ts
interface BoardRequest {
  title: string;
  sections: {
    id: string;
    heading: string;
    meta?: string;
    items: { id: string; label: string; on: boolean }[]; // every candidate; on = carries it
    readonly?: boolean; // only the on items, as chips without ×; no add… input
  }[];
  create?: { label: string; pattern?: string };  // "New tag…"; pattern = allowed names
  apply: { label: string };
}
```

The page shows each section's `on` items as chips; the other items are the suggestions of its
`add…` input.

Answer: `{ changes: { section: string; item: string; on: boolean }[]; created: string[] }`, or
null when closed. Only real differences are sent; a created section only matters through its
`on` changes.

- `Ui.board(request)`, and `ModuleApi` gets `api.ui.board`.
- Caps: 40 sections × 200 items × 300 characters, as for `sections`. The size comes from
  `notifySize`, and the page scrolls.

### `tag -l` on `board` (cmdabl-modules)

- One section per tag, with every track as an item.
- Apply → group the changes per track → `planTags` / `tags_set` (one write per track) → a quiet
  result; the change and `undo:` lines go to `log` (0011).
- After Apply the board stays closed and the result is shown (decision 4).
- A failed write shows the ✓/× result. The script being down gives exit 5, as today.

### Keyboard path: `tag --edit <tag>` (`-e`)

`tag --edit fx` opens the existing pick list:

- every track, `multi: true`, `state: { label: "tagged fx", change: "toggle" }`;
- Tab marks and Enter writes, the mute pick-list pattern, so `select` needs no change.
- `ModuleApi.pick` gets the additive option `state: { label, values, change }`, passed to
  `pickNodes` (architect, 2026-10-20; until then only the platform's `--pick` flow had states).

`--edit` takes the tag as its value (`tag -e fx`, `tag -e #fx`), because the first positional
is the target path and is resolved before the handler. `tag -e #` first opens the tag list
with the new-tag row (bare `#` = the tag list, as elsewhere). Usage: `tag --edit [<tag|#>]`; a bare `tag -e` means `tag -e #` (user, Live test 2026-10-21; core adds
`OptionDef.valueDefault`). `tag -e #` is single-select: Enter picks the tag (`73f0079`, `702fcca`). It ships with the
board as the keyboard path (decision 5).

## Board editing (released in 0.1.5; user decisions 2026-11-04/05)

- **Board contract (additive):** section `renamable?`/`removable?`; answer `renamed?: [{section, to}]`,
  `removed?: [section]`, `confirmed?: true`. A module applies `removed` only when confirmed, otherwise
  it asks once itself; a rename plus a removal of the same section: the removal wins. Renames use the
  `tag -r` logic (an existing name merges).
- **Removing a whole tag** is confirmed inside the board (a confirm bar, Cancel by default); removing
  one track is not asked. Only × or Backspace on a selected chip removes; a click on the name selects.
- **Layout:** "+ # New tag…" pinned on top and focused at open, with collected tracks below it like a
  tag row; each tag's add field in its heading; "untagged" last, folded, read-only. Sections with more
  than 20 tracks start folded (`FOLD_AFTER`, a setting with the 0.1.6 settings page).
- **Click to assign:** the target is the tag whose field or chips have focus (not a heading passed with
  ↓), or New tag. A click or Enter on an untagged track adds it as a pending chip; the cursor stays in
  the list. A track left without tags returns as a card under "untagged" (the section appears even
  when every track was tagged); a tag losing its last track shows "tag goes away".
- **Keys like a file tree:** ↑↓ between headings; → unfolds, then into the field, then the chips; ←
  back out; Enter on a heading goes into its field; Space folds; typing on a heading or a chip goes
  into that tag's field (untagged: the target's field). In a field with suggestions: → enters the
  suggestion row, ←/→ walk it, ← on the first returns, typing edits; **Tab completes** the text;
  **Enter adds** and keeps the text and list, unless the added name equals the typed text (then the
  field clears and the next Enter applies). Esc clears.
- **No browser tooltips** (user, 2026-11-05): `aria-label` instead; the footer help line that follows
  the mouse comes in 0.1.6.

## The UI pattern in `ui/`

- **Core surfaces** are generic, can be themed and replaced, and their contract is in
  `src/core/surfaces/ui.ts` and 0007 §1. The page is `ui/<surface>.html`.
  - `prompt` is `interface.html`, `select` is `pick.html`, `notify` is `feedback.html`.
  - `board` will be `board.html`.
- **Module pages** are pages only one module needs, opened with `api.dialog`. They move to
  `ui/modules/<module>/…`, for example `ui/modules/pakabl/list.html`.
- **Rule:** when a second module needs the same kind of page, it becomes a core surface. Every
  page answers once when it closes, and edits follow collect → apply.

## Tag list and tag editor (user finding tag-0, decided 2026-11-11; 0.1.8)

The board (`tag -l`) and the edit list (`tag -e`) did similar jobs. They become one **tag editor**
(`tag -e`), and `tag -l` goes back to a simple **tag list**. Terms: [GLOSSARY.md](GLOSSARY.md).

**Decisions:**
1. **`tag -e` opens the tag editor.** No `--board` name: one way in.
2. **`tag -l` is the tag list:** a read-only pick list, one row per tag (`#drums · 3 · Kick, Snare, Hat`),
   untagged tracks as a last read-only row (Enter does nothing there). Enter on a tag row runs the
   setting **`tag.listEnter`**, a command line with `{}` for the tag; default `find #{}` (so `find next`/`find prev`
   step through the tracks), e.g. `tag -e {}` or `mute #{}`.
3. **Two views of the tag editor**, sharing the same pending changes and one Apply; a header button (and a
   key that doesn't type into the filter, e.g. `Ctrl+G`) switches; the setting **`tag.editView`** picks
   the one that opens (default `list`):
   - **List view, two panes:** the tags on the left, one per row with the track count and the pending
     changes (`fx 4 · +2`); the current tag's tracks on the right, each with a checkbox. ↑/↓ on the left
     choose the current tag, → goes into its tracks, ← back (deeper = →, out = ←, as in 0019 §5). The
     arrows stay the way to move; what was missing is visual feedback, so the current tag is clearly
     highlighted and the pane with the focus is marked.
   - **Grid view:** tracks as rows, tags as columns, a checkbox per cell. Arrows move from cell to cell,
     Space toggles; ↑ from the first row reaches the column header. Mouse: click a cell; the header has
     the pencil and ×.
   - In both: F2 renames the current (or header) tag, Shift+Backspace marks it for removal, as on the
     board today; an existing name merges.
4. **Writes on Apply,** like the board. Esc closes without changes, and asks first when changes are
   pending. Space on a checkbox makes a pending change, not a mark.
5. **Filter:** typing filters the tracks (in the grid also the tag columns). The setting **`tag.filter`**:
   `compact` (default) hides what doesn't match; `highlight` keeps everything and ↑/↓ skip the rows that
   don't match. Esc clears the filter first.
6. **"+ New tag…" stays pinned at the top.** In the grid a new tag adds a column; in the list view it
   becomes the current tag.
7. **Fewer pages:** `tag -e` without a tag no longer asks which tag first (it opens on the first tag);
   `tag /Lead` without names opens the tag editor with Lead in focus instead of its own tag list. Two
   pages remain (`-l`, `-e`). The lines that write without a page stay: `tag /Lead fx`, `-s`, `-r`.
8. **Built on 0019 phase 4** (`listnav.js`, one keyboard model). The tag editor is its first page user,
   so the keys aren't built twice. The mark key there: Space marks, Tab only completes (0019 §5).

**Rule for options** (applies to every module; the option review after tag-0 uses it): one page per job,
and every write can also be done in one line, so it works in `;` chains, `map` bindings and scripts.

**Rollout:** after 0019 phase 4. cmdabl-ui (the page, browser-checked against the UX checklist),
cmdabl-modules (`tag -l` list, `tag -e` on the new page, the three settings), cmdabl-core only if the
board surface contract changes (a decision for then: extend `board` or a new surface), cmdabl-docs (the
Tags section, reference, images: "board" leaves the docs).

### Build (0.1.8; architect 2026-11-12, surface decided by the user)

- **A module page, not a core surface** (user, 2026-11-12): `ui/modules/tag/editor.html` through
  `api.ui.dialog`, on `ui/listnav.js`. The `board` surface (`src/core/surfaces/board.ts`, `ui/board.html`,
  `api.ui.board`, `BoardRequest/Answer`) is removed (done, 0.1.8); it comes back as a core surface only
  when a second module needs one (rule above).
- **Gear on module pages** (cmdabl-core, a small `ModuleApi` addition): a module page opened with a gear flag
  that answers `{"settings": true}` gets what the board gets today: core opens `<module> config` and runs
  the line again. **Shape (built):** an options argument, `api.dialog(html, w, h, name?, { gear: true })` and
  `gear: true` in the options of `api.ui.livePage`. The page draws the gear itself and answers `{"settings": true}`;
  core (`takePageAnswer`) then hands the module `null` (closed), opens the settings and runs the line again. The flag
  counts only while a command with declared settings runs; otherwise it is dropped and the answer arrives as a plain
  string. Same rule as the board: the WHOLE line runs again, so only a command that writes after the page closed may use it.
- **Page data** (`TAG_EDITOR`, owned by the tag module):
  `{ view: "list"|"grid", filter: "compact"|"highlight", help, gear: true,
     tracks: [{ id, name, group? }], tags: [{ name, tracks: [id] }], focus?: { tag? , track? } }`.
  Tracks in Set order; `group` is the parent group's name for display.
- **Answer:** `""` / null = closed, nothing written; `{"settings": true}`; or
  `{"apply": { "rename": [{from, to}], "remove": [tag], "set": [{tag, track, on}] } }`.
  Order: renames (an existing name merges), then removes, then `set` with the tags' **final** names. The
  module validates every name and id against the request and writes with `planTags`/`tags_set`, one write
  per track (open question below); the result lists the changes and `undo:` lines as today.
- **Built in the module (0.1.8):** `src/modules/tag/` — `command.ts` (commands; takes the page template so tests don't import
  html), `editor.ts` (page data, `parseAnswer`, `finalTags`), `list.ts` (`tag -l` rows). The page fills its
  `/*TAG_EDITOR_PLACEHOLDER*/null` slot (`fillTemplate`). The page answer is validated against the request: unknown tag or
  track, invalid name or wrong shape is exit 2 and nothing is written; `{"settings":true}` (the gear where core ignores it) counts as
  closed. Apply writes per track and says `N tracks changed. Cmd+Z can't undo tag changes; cmdabl log --undo lists the commands that put them back.`; a merge is named first. Settings:
  `tag.listEnter` (an enum of presets until settings have a text kind), `tag.editView`, `tag.filter`; `tag.foldAfter` is gone.
- **Running a line from a module:** `api.commands.run`, decided in [0028](0028-inner-runs.md). First user:
  `tag -l` Enter → `tag.listEnter` (four presets: `find #{}`, `tag -e {}`, `mute #{}`, `solo #{}`).
- **Gear only where it works:** `api.settings.gearAvailable()` (core) tells whether the current run has a
  settings round (a palette line); the page hides the gear otherwise.
- Sizes: the page fits Live's dialog limits; the grid scrolls both ways with the tag header and the
  track column sticky.

## Open questions

- A large change set leaves one undo step per track written. **Accepted for 0.1.8** (architect,
  2026-11-12): the same as the board since 0.1.2; the result text says Cmd+Z cannot undo tag changes and points to `cmdabl log --undo` (user test, 2026-11-12: the undo steps are only the colour toggle). A batched
  `tags_set` would be a bridge protocol change (the user's call); revisit after 0.1.8.

## Phased rollout

1. cmdabl-core: the `board` contract, `api.ui.board`, the presenter caps and tests; the
   0007 §1 row.
2. cmdabl-ui: `ui/board.html` (chips with ×, an `add…` input with ghost text and suggestions,
   new tag…, a live count on Apply, keyboard), checked in the browser.
3. cmdabl-modules: `tag -l` on `board` (changes, created tags); `tag --edit` if kept.
4. cmdabl-core: move `pakabl-list.html` to `ui/modules/pakabl/list.html`, architecture rule.
5. cmdabl-docs: the Tags section of using.md and the reference.

## Verification

- Every phase: `npm test` and `npm run build`. The ui agent checks `board.html` in a browser.
- Live:
  - In `tag -l`, mark two labels and press Apply: the tags are gone, the board closes and the
    result shows the undo lines.
  - Close with nothing marked changes nothing.
  - Open a tag, tick two tracks, untick one, Apply: exactly those three changes are written.
  - New tag… "perc", tick a track, Apply: the track is tagged `perc`.
  - New tag with nothing ticked: nothing is written.
  - With the script off, the command gives exit 5.
