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
| `prompt` — the palette | `{ items: PaletteItem[] }` (later also the command tree and keymap, see 0006) | a `PaletteResult`, or null when dismissed |
| `select` — the pick list | `{ title, multi, items: [{ label, detail?, value? }], preview? }` (`preview`/`value`: see section 4) | indexes of the chosen items, or null when cancelled |
| `notify` — a message | `{ text, code }` (`code` = the exit code it belongs to) | nothing |

Everything is plain JSON. A page receives its request through a build-time placeholder and
answers with `close_and_send`; each page documents this in a comment at its top.

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
`> mute /Vermona MIDI "/Vermona DRM Audio"`. It grows with every mark; with nothing marked it
shows the active row. It is what history will store. Read-only on purpose: sharing one field
between filter and selection would need quoting for names with spaces and collides with `Space`.

- `SelectRequest.preview?: { before, after }` — the command text around the ambiguous address;
  absent means no line.
- `items[].value?` — the text a row contributes (its unique path, quoted where needed);
  `items[].label` is the unique path, so same-named siblings can be told apart.
- The return value is unchanged. A module's own `api.pick` has no preview line yet.

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
  (STATUS.md, "Next"). Phase 1 leaves the selection where it is, phase 2 restores it.
- Open: whether `next`/`prev` are still needed once follow mode exists. Kept until the spike is
  decided — they need no open window and are what a keymap binds to a key.

## Open questions

- File-based replacement reads outside the bundle — the same caveat as pakabl if the announced
  stricter OS sandbox arrives; levels 1 and 3 can stay inside the bundle.
- **Dialog size.** The user cannot resize a dialog: `showModalDialog(url, width, height)` fixes
  the size when it opens, the SDK has no resize call, and a page cannot resize its native window
  (a resize handle was requested in the Live test). Instead: size `notify` from its text (line
  count and longest line — `help` wraps at 500×180), raise the pick list's maximum, and make the
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
