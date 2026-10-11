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
| `select` — the pick list | `{ title, multi, items: [{ label, detail? }] }` | indexes of the chosen items, or null when cancelled |
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

## Open questions

- File-based replacement reads outside the bundle — the same caveat as pakabl if the announced
  stricter OS sandbox arrives; levels 1 and 3 can stay inside the bundle.
- Dialog size is chosen by the host today (`createDefaultUi`); a replacement page may need to
  declare its preferred size (a `<meta>` tag read before opening?).
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
