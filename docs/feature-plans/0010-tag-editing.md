# Tag editing: an interactive overview and one tag on many tracks

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0008](0008-tags-and-aliases.md) (tags on tracks, `tag -l`),
[0007](0007-ui-surfaces.md) (a new surface `board`).

**Status:** In Progress (built: board `96e838a`/`d468176`, `tag --edit` `9bba54c`, `tag -l` on
board `11815ba`; Live test pending) — 0.1.2 (user, 2026-10-20: 0.1.1 is released first; 0.1.2 = this plan;
the store and aliases move to 0.1.3). Branch `feat/tag-board`.

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
   - The contract goes in `src/core/ui.ts`, the page is `ui/board.html` and uses `shared.css`.
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
- **←/→ and ↑/↓** move through the suggestions while they show (←/→ added after the Live test;
  Cmd/Alt+←/→ still move the caret), otherwise to the previous or next tag's
  input. **Enter applies whenever there is nothing to add**: in an empty input, an empty "new tag…" or on
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
with the new-tag row (bare `#` = the tag list, as elsewhere). Usage: `tag --edit <tag|#>`. It ships with the
board as the keyboard path (decision 5).

## The UI pattern in `ui/`

- **Core surfaces** are generic, can be themed and replaced, and their contract is in
  `src/core/ui.ts` and 0007 §1. The page is `ui/<surface>.html`.
  - `prompt` is `interface.html`, `select` is `pick.html`, `notify` is `feedback.html`.
  - `board` will be `board.html`.
- **Module pages** are pages only one module needs, opened with `api.dialog`. They move to
  `ui/modules/<module>/…`, for example `ui/modules/pakabl/list.html`.
- **Rule:** when a second module needs the same kind of page, it becomes a core surface. Every
  page answers once when it closes, and edits follow collect → apply.

## Open questions

- A large change set leaves one undo step per track written. Is a batched `tags_set`
  (script op) worth it?

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
