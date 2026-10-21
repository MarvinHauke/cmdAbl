# Tag editing: an interactive overview and one tag on many tracks

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0008](0008-tags-and-aliases.md) (tags on tracks, `tag -l`),
[0007](0007-ui-surfaces.md) (a new surface `board`).

**Status:** In Progress — 0.1.2 (user, 2026-10-20: 0.1.1 is released first; 0.1.2 = this plan;
the store and aliases move to 0.1.3). Branch `feat/tag-board`.

## Context

`tag -l` (0.1.1) shows each tag with the tracks that carry it. It is a read-only `notify` page
built from `CommandResult.sections`. In the Live test the user asked for two things:

- removing a tag from a track by clicking the track's label in that overview;
- assigning one tag to many tracks at once.

A dialog cannot call the extension while it is open. It answers once, when it closes. Editing
therefore follows the pick-list rule that Live changes only on confirm: the page collects the
changes, the extension applies them after the dialog closes, then reopens the page.

## Decisions (user, 2026-10-20)

1. **The overview collects, then applies.**
   - A click on a track label in `tag -l` marks it for removal; the label is struck through, and a
     second click unmarks it.
   - The footer shows `Apply (N changes)` and `Close`.
   - Apply closes the page with the change set. The module writes it with the existing
     `planTags` and `tags_set` (one write per track), then reopens the overview with the new state.
   - Close, or Esc, ends the loop.
   - The result message lists the changes and the `undo:` lines, as `tag` does today.
2. **Assign in the same window, like Live's browser tag panel** (user, 2026-10-20): each tag in
   the overview opens a checkbox list of every track; ticking adds the tag. No second dialog.
3. **A generic core surface `board`, not a module page.**
   - The contract goes in `src/core/ui.ts`, the page is `ui/board.html` and uses `shared.css`.
   - It can be themed and replaced like the other surfaces (0007 §2).
   - Later users: aliases, the history list, tags on chains and pads.
4. **After Apply the board reopens** with the new state; Close ends it and shows one summary of
   all applied changes with the `undo:` lines.
5. **`tag --edit <tag>` (`-e`) ships with it** as the keyboard path (name decided by the
   architect: the user already calls it that).
6. **An "untagged" section** lists the tracks without any tag, read-only (chips without ×, no
   checkbox list) — ticking a track in a tag's list is how it leaves it. Contract: a section has
   `readonly?: true`.
7. **Module pages stay where they are** for now (`ui/pakabl-list.html`); the `ui/modules/`
   move is optional tidying, done only when a second module page appears.

## Design (draft)

Modelled on the tag panel in Live's browser (user, 2026-10-20): per tag group a list of
checkboxes with "Add Tag…", and for the selected item a bar of chips with × and "Add…".

### What the overview looks like

```
#drums  ▾                                   5 tracks
  [/Synth ×] [/Bass ×] [/Lead ×] [/Drums ×] [/Guitar ×]
#lead   ▸                                   1 track
  [/Lead ×]
  ┌ ▾ open: every track with a checkbox ───────────────┐
  │ [x] /Lead   [ ] /Synth   [ ] /Bass   [ ] /Guitar … │
  └────────────────────────────────────────────────────┘
⊕ New tag…
                                   [Apply (3 changes)] [Close]
```

- **Chips:** each tag lists its tracks as chips. A click on a chip, or on its ×, marks it for
  removal (struck through; another click unmarks it).
- **▸ / ▾ per tag:** opens a checkbox list of every track (regular tracks and return tracks, as
  for `!#`), filterable by typing. Ticking adds the tag, unticking removes it. The chips and the
  checkboxes show the same pending state.
- **⊕ New tag…:** a text field that adds an empty tag section on the page (the name is checked
  as in `tag`); its checkbox list opens at once. A tag with no ticked track is not kept, because
  tags exist only on tracks.
- **Apply (N changes)** sends the change set; Close or Esc discards it.
- **Keyboard:** ↑/↓ moves through tags and rows, Space toggles, → / ← opens and closes a tag,
  Enter applies.

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
    readonly?: boolean; // only the on items, as chips without ×; no checkbox list
  }[];
  create?: { label: string; pattern?: string };  // "New tag…"; pattern = allowed names
  apply: { label: string };
}
```

The page shows each section's `on` items as chips and all items in the expandable list.

Answer: `{ changes: { section: string; item: string; on: boolean }[]; created: string[] }`, or
null when closed. Only real differences are sent; a created section only matters through its
`on` changes.

- `Ui.board(request)`, and `ModuleApi` gets `api.ui.board`.
- Caps: 40 sections × 200 items × 300 characters, as for `sections`. The size comes from
  `notifySize`, and the page scrolls.

### `tag -l` on `board` (cmdabl-modules)

- One section per tag, with every track as an item.
- Apply → group the changes per track → `planTags` / `tags_set` (one write per track) → the
  result with the `undo:` lines.
- Reopen the overview after Apply, or end with the result? Open question below.
- A failed write shows the ✓/× result. The script being down gives exit 5, as today.

### Keyboard path: `tag --edit <tag>` (optional)

`tag --edit fx` opens the existing pick list:

- every track, `multi: true`, `state: { label: "tagged fx", change: "toggle" }`;
- Tab marks and Enter writes, the mute pick-list pattern, so `select` needs no change.

Without a tag, `tag --edit` first opens the tag list with the new-tag row. Once the overview
can do this, `--edit` only stays if a fast keyboard path is still wanted (open question).

## The UI pattern in `ui/`

- **Core surfaces** are generic, can be themed and replaced, and their contract is in
  `src/core/ui.ts` and 0007 §1. The page is `ui/<surface>.html`.
  - `prompt` is `interface.html`, `select` is `pick.html`, `notify` is `feedback.html`.
  - `board` will be `board.html`.
- **Module pages** are pages only one module needs, opened with `api.dialog`. They move to
  `ui/modules/<module>/…`, for example `ui/modules/pakabl/list.html`.
- **Rule:** when a second module needs the same kind of page, it becomes a core surface. Every
  page answers once when it closes, and edits follow collect → apply → reopen.

## Open questions

- A large change set leaves one undo step per track written. Is a batched `tags_set`
  (script op) worth it?

## Phased rollout

1. cmdabl-core: the `board` contract, `api.ui.board`, the presenter caps and tests; the
   0007 §1 row.
2. cmdabl-ui: `ui/board.html` (chips with ×, expandable checkbox lists with a filter, New tag…,
   a live count on Apply, keyboard), checked in the browser.
3. cmdabl-modules: `tag -l` on `board` (changes, created tags); `tag --edit` if kept.
4. cmdabl-ui and cmdabl-modules: move `pakabl-list.html` to `ui/modules/pakabl/`.
5. cmdabl-docs: the Tags section of using.md and the reference.

## Verification

- Every phase: `npm test` and `npm run build`. The ui agent checks `board.html` in a browser.
- Live:
  - In `tag -l`, mark two labels and press Apply: the tags are gone and the overview reopens
    with the new state.
  - Close with nothing marked changes nothing.
  - Open a tag, tick two tracks, untick one, Apply: exactly those three changes are written.
  - New tag… "perc", tick a track, Apply: the track is tagged `perc`.
  - New tag with nothing ticked: nothing is written.
  - With the script off, the command gives exit 5.
