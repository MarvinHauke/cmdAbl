# Tag editing: an interactive overview and one tag on many tracks

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0008](0008-tags-and-aliases.md) (tags on tracks, `tag -l`),
[0007](0007-ui-surfaces.md) (a new surface `board`).

**Status:** Draft — planned 2026-10-20 for 0.1.2 or later. No builder tasks yet.

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
2. **A generic core surface `board`, not a module page.**
   - The contract goes in `src/core/ui.ts`, the page is `ui/board.html` and uses `shared.css`.
   - It can be themed and replaced like the other surfaces (0007 §2).
   - Later users: aliases, the history list, tags on chains and pads.

## Design (draft)

### The `board` surface (contract addition, cmdabl-core)

Request:

```ts
interface BoardRequest {
  title: string;
  sections: {
    id: string;
    heading: string;
    meta?: string;
    items: { id: string; label: string; removable?: boolean }[];
    actions?: { id: string; label: string }[]; // buttons next to the heading, e.g. "+ tracks"
  }[];
  apply: { label: string };            // "Apply" → "Apply (2 changes)"
}
```

Answer: `{ removed: { section: string; item: string }[]; action?: { section: string; id: string } }`,
or null when the page is closed.

- An action button closes the page at once and carries the removals marked so far, so the module
  applies them first, then handles the action.
- `Ui.board(request)`; `ModuleApi` gets `api.ui.board`. The caps are the same as for `sections`
  (40 × 200 × 300 characters), and the size comes from `notifySize`.

### `tag -l` on `board` (cmdabl-modules)

- One section per tag (`id` = the tag), with one item per track (`id` = the path, `removable`).
- Each section has the action `+ tracks`.
- The loop is: open → apply `removed` → handle the action → reopen, until the page is closed.
  A failed write ends the loop with the ✓/× result.
- The script being down gives exit 5, as today.

### One tag on many tracks: the tag-first pick list

`tag --edit fx` (the name is still open) opens the existing pick list:

- every regular track (the same set as `!#`) and the return tracks;
- `multi: true`, `state: { label: "tagged fx", change: "toggle" }`, and each row's `state` is
  `on` when it carries `fx`;
- Tab marks rows, the dashed ring shows what Enter changes, and Enter writes. This is the
  mute pick-list pattern, so the `select` surface needs no change.

Further rules:

- Without a tag, `tag --edit` first opens the single-select tag list with the new-tag row
  (`api.pickTags(..., { allowNew: true })`).
- The `+ tracks` action in the overview opens the same list, and the overview then reopens.
- This gives two mirrored ways in: `tag /Lead` picks the tags of one track, and
  `tag --edit fx` picks the tracks of one tag.

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

- The name of `--edit` (`--edit`, `--tracks`, `-e`).
- Should `board` also offer chips for adding inside the overview, or is the `+ tracks` pick
  list enough?
- Should the overview show an "untagged" section?
- A large change set leaves one undo step per track written. Is a batched `tags_set`
  (script op) worth it?

## Phased rollout

1. cmdabl-core: the `board` contract, `api.ui.board`, the presenter caps and tests; the
   0007 §1 row.
2. cmdabl-ui: `ui/board.html` (click to strike, a live count on Apply, action buttons, Esc and
   keyboard focus), checked in the browser.
3. cmdabl-modules: `tag -l` on `board` with the loop; `tag --edit` with the pick list.
4. cmdabl-ui and cmdabl-modules: move `pakabl-list.html` to `ui/modules/pakabl/`.
5. cmdabl-docs: the Tags section of using.md and the reference.

## Verification

- Every phase: `npm test` and `npm run build`. The ui agent checks `board.html` in a browser.
- Live:
  - In `tag -l`, mark two labels and press Apply: the tags are gone and the overview reopens
    with the new state.
  - Close with nothing marked changes nothing.
  - `+ tracks` opens the pick list, then the overview reopens.
  - `tag --edit fx` switches the tag on the marked rows.
  - `tag --edit` with a new name creates the tag.
  - With the script off, the command gives exit 5.
