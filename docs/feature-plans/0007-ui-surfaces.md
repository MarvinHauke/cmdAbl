# UI surfaces — replaceable palette, pick list and messages

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0005](0005-command-tree-and-module-authoring.md) (pick list, raw-line dispatch).

**Status:** In Progress — the contract shipped (2026-10-11); themes and replaceable surfaces are
not built yet. Triggered by wanting to change the UI later, or plug in a different one, the way
Neovim lets a plugin replace `vim.ui.select`.

## Context

cmdAbl shows three dialogs: the palette (`ui/interface.html`), the pick list (`ui/pick.html`)
and messages (`ui/feedback.html`). Each is an SDK modal webview that receives its data inlined
into the page and can return exactly one string when it closes.

That constraint is also what makes them replaceable: a dialog is fully described by *data in,
one value out*. Since 2026-10-11 the platform only talks to that contract — `src/core/ui.ts`
defines `Ui { prompt, select, notify }`, and `createDefaultUi()` implements it with the pages
under `ui/`. `src/extension.ts`, the resolver and the modules never open an HTML page themselves.

"Done": a user can restyle cmdAbl without code, and replace any of the three dialogs with their
own page, without touching the core or any module.

## Goals / Non-goals

**Goals**
- One stable, documented contract per surface.
- Three levels of customization: theme, replacement page, replacement implementation.
- A broken customization falls back to the built-in UI instead of breaking the palette.

**Non-goals**
- Dockable or permanent panels inside Live — the SDK only offers modal dialogs.
- Loading third-party *code* into the Extension Host (SDK-blocked, see 0003). A replacement
  page is data the webview renders, not code the host runs.

## Architecture

### 1. The contract (`src/core/ui.ts`)

| Surface | In | Out |
|---|---|---|
| `prompt` — the palette | `{ items: PaletteItem[], initial? }` (later also the command tree and keymap, see 0006) | a `PaletteResult`, or null when dismissed |
| `select` — the pick list | `{ title, multi, items: [{ label, detail?, value?, state? }], preview?, fill?, state?, create? }` (`preview`/`value`/`fill`/`state`: see section 4; `create: { label }` offers a row `+ <label> "<trimmed filter text>"` after the matches while the filter is non-empty and matches no row exactly; when nothing matches it is the only row and has the cursor, as in 0008) | indexes of the chosen items, `{ fill: index }`, `{ created: "<trimmed filter text>", picked: [indexes of the rows marked] }` (only when `create` was sent; `picked` is empty in a single-select list), or null when cancelled |
| `notify` — a message | `{ text, code, link?, sections? }` (`sections: [{ heading, meta?, items: string[] }]` from `CommandResult.sections` = a structured overview the page draws instead of `text`, which stays the plain fallback; capped by the presenter to 40 sections × 200 items × 300 characters; the page gets it through `/*SECTIONS_PLACEHOLDER*/null`; `code` = the exit code it belongs to; `link: { label, url }` = a button next to Close, a plain https URL, from `CommandResult.link`; the page gets it through `/*LINK_PLACEHOLDER*/null`) | nothing, or `{"open":true}` when the link button was clicked (the platform then opens the request's own `url` with `openUrl`; a failure opening it is shown as a message) |

| `board` — an editable overview (planned, [0010](0010-tag-editing.md)) | `{ title, sections: [{ id, heading, meta?, items: [{ id, label, on }] }], create?: { label, pattern? }, apply: { label } }`: the `on` items are chips with ×, and each section expands to a checkbox list of all items (like the tag panel in Live's browser) | `{ changes: [{ section, item, on }], created: [ids] }`, or null when closed |

Everything is plain JSON. A page receives its request through a build-time placeholder and
answers with `close_and_send`; each page documents this in a comment at its top.

**Where pages go in `ui/`** (decided 2026-10-20, 0010):
- Core surfaces are generic and replaceable: `ui/<surface>.html`, with the contract here.
- A page only one module needs is opened with `api.dialog` and lives in `ui/modules/<module>/`.
  `pakabl-list.html` moves there.
- When a second module needs the same kind of page, it becomes a core surface.
- Editing pages collect the changes and answer once; the extension applies them and reopens the
  page.

### 2. Three levels of customization

1. **Theme (no code).** `ui/shared.css` already drives all three pages through CSS variables
   (`--bg`, `--accent`, …). A user file `<Extensions folder>/.cmdabl/theme.css` is appended after
   it and can restyle everything.
2. **Replacement page per surface.** If `<Extensions folder>/.cmdabl/ui/select.html` (or
   `prompt.html`, `notify.html`) exists, it is loaded instead of the built-in page, receives the
   same request and must return the same kind of value. A read error or an invalid answer falls
   back to the built-in page and logs why. No rebuild — reopening the palette is enough.
3. **Replacement implementation.** `api.ui.register("select", impl)` lets a bundled module supply
   a surface in code (e.g. a navigation mode as an alternative `prompt`). A user page from
   level 2 takes precedence.

### 3. Helping custom `prompt` pages

A replacement palette should not have to re-implement completion. The tokenizer and the
completion logic (0006) are shipped as one script a page can include, so a custom page only
decides how things look.

### 4. The pick list: zones, command line, follow mode (from the Live test, 2026-10-11)

**Two zones (built in `1b305f6` and `d8ca020`; `Space` marking and the command line seen
working in Live with `mute`; `ui/pick.html` only, no contract change).** The page tracks whether
the *filter* (initial) or the *list* is active:

- In the filter, `Space` types a space, so `vermona midi` can be typed.
- In the list of a multi-select pick, `Space` marks the active row and moves down one.
- No key of its own to switch: `↓`/`↑` (and `Ctrl+n`/`Ctrl+p`) enter the list. In a multi-select
  pick the first arrow only enters it and keeps the active row, so `↓` `Space` marks the first
  row (the user found skipping it odd); in a single-select pick the arrows move at once.
- Any typed character other than `Space`, and `Backspace`, `Delete`, `←`/`→`, `Home`, `End`,
  return to the filter.
- `Ctrl+Shift+D` toggles a diagnostic in the hint line (the last key event) — for Live tests,
  not a feature.
- The same in both zones: `Esc` cancels (closes, nothing runs, no history entry), `Enter`
  confirms, `Tab` marks.
- The active zone is visible, and the hint line names `Space mark` only in the list. In a
  single-select pick `Space` is always a space.
- DOM focus stays in the input; the zone is state in the key handler, so no keystroke is lost
  whatever the webview does with focus.

**Command line in the pick list (built: data in `900f89d`, page in `1b305f6`; untested in
Live).** Above the filter the
page shows a read-only line with the command `Enter` will run, e.g.
`> mute /Vermona MIDI "/Vermona DRM Audio"`. It grows with every mark; with nothing marked a
multi-select list shows the command without a target (user, 2026-10-19: no preselection), a
single-select list the active row. It is what history will store. Read-only on purpose: sharing one field
between filter and selection would need quoting for names with spaces and collides with `Space`.

- `SelectRequest.preview?: { before, after }` — the command text around the ambiguous address;
  absent means no line.
- `items[].value?` — the text a row contributes (its unique path, quoted where needed);
  `items[].label` is the unique path, so same-named siblings can be told apart.
- The return value is unchanged. A module's own `api.pick` has no preview line yet.

**`Tab` fills the palette (user, 2026-10-13; contract addition, in work).** In a single-select
pick list, `Tab` on a row puts that object into the command prompt for a follow-up command
instead of running; `Enter` runs as before. Multi-select lists keep `Tab` = mark.

- `SelectRequest.fill?: boolean` — the page offers it only when true and `multi` is false. The
  page then answers with one of three values: confirmed indexes (`[2, 0]`), cancelled (`''`),
  or `{"fill": 3}` (an index into `items`). `Ui.select` resolves
  `number[] | { fill: number } | null`.
- `PromptRequest.initial?: { text: string; cursor: number }` — the palette opens with the text
  in its input and the caret at `cursor`. The platform sends a leading space and the object's
  unique path in canonical form, cursor 0, because the command comes first.
- Flow: a fill ends the running command without calling or continuing its handler — nothing
  is remembered, the log says `run: <line> -> filled` — and the palette opens again through
  the dialog queue.
- Allowed in every single-select list the platform opens for a `path` argument (also "did you
  mean"); a module's own `api.pick` opts in with `{ fill: true }`, as `find` does.
- Hint line: "Enter run · Tab put in prompt · Esc cancel".

**State symbols (wanted by the user 2026-10-12; contract accepted 2026-10-13, in work).** When
`mute`, `solo` or `arm` opens a pick list, each row shows whether that object is already muted,
soloed or armed, so a toggle is not applied blindly. Commands without such a state (`goto`,
`find`, `lom`) show nothing.

- Page: `SelectRequest.state?: { label }` names the state ("muted"); `items[].state?:
  "on" | "off"` (absent = unknown, no button). First built as `●`/`○` before the label with a
  legend (`e852014`); replaced after the user's review (2026-10-18, `839920a`) by a small
  button on the right of the row, drawn like Live's mixer: `muted` → speaker (Phosphor
  "speaker-simple-none", MIT), lit when the object is **audible** (state "off") — inverted on
  purpose, as Live's track activator; `soloed` → "S" and `armed` → record dot, lit when "on";
  an unknown label → a plain square, lit when "on". No legend; the button's tooltip says
  "muted"/"unmuted" etc. The page picks the icon from `state.label` — no contract change.
- Colours (user, 2026-10-19): Live's theme tokens, values from Live 12's default theme
  ("Default Dark Neutral Medium.ask") — mute `ChosenDefault` `#ffad56`, solo
  `ChosenPreListen` `#3c6ab6`, arm `ChosenRecord` `#ff5559` — as CSS variables
  `--live-chosen-*` in `ui/shared.css`, for the lit fill and the pending ring. The SDK cannot
  read Live's current theme; following it is a candidate feature request.
- Left side of a row is selection only: a marked row has a light accent tint and a bold
  label (readable without colour); the cursor row has the grey background and accent text.
- **Preview (user, 2026-10-19; `0462eba` core, `250fdd5` modules, `4f43d7f` page).** `SelectRequest.state.change?:
  "toggle" | "on" | "off"` says what confirming does to a row's state; the node declares it
  through `pickState`, `mute`/`solo`/`arm` set "toggle" without `--set`, else "on"/"off".
  The rows confirming would act on — the marked ones in a multi-select list (nothing marked: none; `Enter` then runs nothing
  and the hint asks for a mark; exception: the create row answers `Enter` when it is under the
  cursor, marked or not, together with the marked rows — 0008), the cursor row in a single-select list — show the
  **resulting** state at once, with a dashed accent ring while it differs from Live ("pending,
  not applied"); tooltip "muted (on confirm)". With `change` present, marks lose the row tint
  (the button shows them) and keep the bold label; a marked row whose result equals its
  current state shows only the bold label — accepted, no extra left bar (the user wanted no
  left gutter). Without `change` the page behaves as before.
  Known limit: `arm` with "on" previews "armed" also on rows Live refuses (return, main,
  group tracks).
- Command node: `pickState?: { label, read(nodes, invocation) }` on a runnable command;
  `read` returns true / false / null per candidate (0005).
- Platform: `read` is called only when a pick list is about to open (ambiguity and "did you
  mean" alike), capped at 600 ms; a failure, a timeout or a wrong-length answer means no
  symbols — never an error.
- Sources: track mute and solo from the SDK; track arm from the Remote Script (`track_facts`)
  when it answers, else the SDK value; chain and pad mute/solo from the script
  (`chainSwitches`); no script → no symbol for chains.
- The symbol shows the state when the list opened and does not update.

**Follow mode (draft, depends on the spike in 0006).** The active row is selected in Live while
the pick list is open (a track or a device, through `selectNode`), for every pick list including
multi-select.

- Switched on by a checkbox in the pick list (state is remembered) and by `--follow` /
  `--no-follow`, which override the remembered state for one run.
- Proposed contract change, to be confirmed with the user before building: `SelectRequest`
  gets `follow: boolean`, and the surface reports the active row and the checkbox state through
  a host callback; the return value stays as it is. `--follow` is reserved by the platform like
  `--help`, no module declares it, and `ModuleApi.pick` does not change.
- Transport: the page sends `POST /pick/highlight` to the local server with a per-dialog token;
  the host debounces (~80 ms) and calls the bridge.
- Open: `Esc` cannot restore the previous selection until the Remote Script can reply
  (STATUS.md, "Roadmap to 0.1.0", step 2). Phase 1 leaves the selection where it is, phase 2 restores it.
- Open: whether `next`/`prev` are still needed once follow mode exists. Kept until the spike is
  decided — they need no open window and are what a keymap binds to a key.

## Open questions

- A setting "Enter takes the cursor row" in multi-select lists, to save the `Tab` when one
  target is wanted (user, 2026-10-19; settings phase, not before 0.1.0).

- File-based replacement reads outside the bundle — the same caveat as pakabl if the announced
  stricter OS sandbox arrives; levels 1 and 3 can stay inside the bundle.
- **Dialog size.** The user cannot resize a dialog: `showModalDialog(url, width, height)` fixes
  the size when it opens, the SDK has no resize call, and a page cannot resize its native window
  (a resize handle was requested in the Live test). Instead the host sizes each dialog before
  opening it. Built: `notify` from its text (`src/core/notifySize.ts`, `b6b208a`: width 500…760
  from the longest line, height 110…420 from the wrapped line count, the page scrolls beyond
  that) and the pick list from its rows (`src/core/pickSize.ts`). The numbers were measured in
  headless Chrome, not in Live's webview. Still open: a larger maximum for the pick list, and
  sizes overridable with the settings of phase 2. Candidate for a feature request to Ableton.
  A replacement page may also need to declare its preferred size (a `<meta>` tag read before
  opening?).
- Whether a non-modal experience is possible at all depends on the navigation-mode spike (0006).

## Phased rollout

1. **Contract** — `Ui` interface, default implementation, all callers routed through it. *Shipped.*
2. **Theme file.**
3. **Replacement pages** with validation and fallback; `cmdabl ui` lists the active surfaces and
   where they come from.
4. **`api.ui.register`** and a guide "writing your own UI" with a minimal template per surface.

## Verification

- Phase 1: `npm test`, `npm run build`; in Live the palette, the pick list (`goto vermona`) and
  messages (`help`) look and behave as before.
- Phase 2: a theme file changing `--accent` recolors all three dialogs.
- Phase 3: a copied `select.html` with a changed layout is used; a deliberately broken one falls
  back to the built-in list and the reason appears in the log.
