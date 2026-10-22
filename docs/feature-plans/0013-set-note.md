# `note`: one Markdown note per Set

**Status:** In work for 0.1.3 (user, 2026-10-22: `note` joins the 0.1.3 release with `vol`).
Trigger: the user wants a note per Set for general reminders, written in Markdown.

**Parent:** [0004](0004-command-platform.md)
**Depends on:** the Remote Script's `set_data` (as in [0008](0008-tags-and-aliases.md)). There is no
settings store yet; `note` brings the small file access it needs (below).

## Context

- Live has **Info Text** (right-click → Edit Info Text on tracks, clips, scenes and devices). It
  cannot be used for this:
  - neither the LOM nor the Extensions SDK can read or write it; `docs/sdk-tree.md` has no field for
    it, and an [old forum answer](https://cycling74.com/forums/get-clip-info-in-ableton-live) says
    the same;
  - it is plain text, so Markdown would not render;
  - a scene's info text only shows on hover.
- Rejected as storage:
  - editing the `.als` (gzip XML) from outside, because Live overwrites it on save;
  - a text clip or a locator name, because both pollute the Set.

## Decisions (user, 2026-10-20)

1. **One note per Set**, for general reminders. There are no notes per track.
2. **The note lives in cmdAbl's folder, linked to the Set by an id stored inside the Set.**
   - The link must survive saving the Set under another name.
   - The id is saved in the `.als`, so renaming or moving the Set doesn't break it, and nothing has
     to update on every save.
3. **Save As:** both copies keep the id and share one note.
4. **Only on demand.** The note opens when `note` is typed, never by itself when a Set opens.
5. **View first.**
   - `note` shows the rendered Markdown.
   - `note -e` (`--edit`) opens in edit mode.
   - In the page, `e` (as in vim) or an Edit button switches to edit mode.
   - There is no `--view` flag, because view is the default (architect's recommendation; it can be
     added as an alias).

## Design (draft)

### Storage

- **The id:** `Song.set_data("cmdabl.set-id", <random id>)`, written by the Remote Script.
  - The first `note` in a Set creates the id.
  - This is a write, so the Set asks to be saved: the colour-toggle trick from tags is reused.
- **The file:** `~/Library/Application Support/Ableton/Extensions Data/<extension id>/notes/<id>.md`,
  the extension's own data folder (where `bridge-token` and `run-token` already live). A folder outside
  it is not reachable from the Extension Host's sandbox (corrected 2026-10-22).
  - It is plain Markdown, so it can be edited in any editor.
  - There is no size limit in the Set.
  - A front-matter line records the Set name it was last seen with, for humans.

### The page: `ui/modules/note/note.html` (a module page)

Built: ui `8f47aab`; own renderer of about 6 KB. Output: `""` unchanged, `"\n"` cleared, otherwise the
full text.

**Modes:**

| Mode | What it does |
|---|---|
| View | Renders headings, lists, tables, code and checkboxes. |
| Edit | A plain textarea. |

**Keys:**

| Key | What it does |
|---|---|
| `e` | Switches from view to edit. |
| Cmd+S or Save | Saves and closes the page (architect, 2026-10-22: a page cannot write, so a save held only in the page would be lost on a host-side close). `note` reopens in view. |
| Esc in view | Closes the page. |
| Esc in edit, with changes | The guard from the board (0010): first a warning, the second Esc discards. |

**Behaviour:**

- The page switches modes by itself; it does not need to call the extension.
- It answers once, when it closes: with the new text when the text changed, or with nothing.
- The module writes the file only after the page closes.
- A Set without a note opens straight in edit mode on an empty text.
- **The Markdown renderer** is either a small MIT library inlined at build time (pages cannot load
  from a CDN in Live) or a minimal renderer of our own. The spike decides by size.

### The command

| Usage | What it does |
|---|---|
| `note` | Opens the note in view. |
| `note -e` | Opens the note in edit. |
| `note --help` | Shows the usage. |

- Without the Remote Script, it gives exit 5, because the id needs `Song.set_data`.
- A successful save is quiet; one log line goes to [0011](0011-logging.md).

## Contract additions (additive, 2026-10-22)

- **Bridge:** a new op `set_id {create}` → `{id}` or `{id: null}`. It reads `Song.get_data("cmdabl.set-id")`;
  with `create` it writes a new random id first. The write uses the same "mark the Set as modified"
  trick as tags. Script 0.1.8.
  Built: bridge `f9c1f76`. `set_id` counts as a write op, so the bridge token is needed even for a
  read (the protocol decides by op name). Accepted (architect, 2026-10-22): `note` can't save without
  the token anyway; docs say "reads need no token, except `set_id`".
- **`ModuleApi`:**
  - `api.set.id(create?: boolean): Promise<string | null>`, backed by the op above; null without the
    script;
  - `api.files.read(name)` → `Promise<string | null>` and `api.files.write(name, text)` →
    `Promise<boolean>`, scoped to `<data folder>/modules/<module>/`. Names are plain file names (no `/`,
    no `..`), so a module can't reach other modules' files. The note file is
    `modules/note/<id>.md`.
  - Built: core `d9d5a9f`. The data folder is the SDK's `context.environment.storageDirectory`, falling
    back to the Extensions Data path; writes are atomic and capped at 1 MB.
- **Renderer:** the ui agent writes a small renderer of its own (headings, lists, checkboxes, tables,
  code, emphasis, links). It is inlined; no library unless that ends up over about 20 KB.

## Open questions

- Does `Song.set_data` survive saving, reloading, Save As, and Collect All and Save?
- Does `Song.set_data` mark the Set as modified? Tags needed a trick for this on tracks.
- Does the SDK know the Set's name or path? It would fill the "last seen as" line.
- The renderer: a library or our own code, and how many kB each costs.
- Later:
  - export the note into the project folder (`<Project>/cmdAbl-note.md`);
  - a table editor;
  - a reminder when the Set opens.

## Phased rollout

1. **cmdabl-bridge:** the `set_id` op with tests; script 0.1.8. The Live spike (save, reload, Save As)
   is the user's check, after step 5.
2. **cmdabl-core:** `api.set.id` and `api.files` with tests (sandbox path, name checks).
4. **cmdabl-ui:** `note.html` with view, edit and the renderer.
5. **cmdabl-modules:** the `note` module.
6. **cmdabl-docs:** a section in using.md.

## Verification

- Every phase: `npm test` and `npm run build`. The ui agent checks `note.html` in a browser.
- Live:
  - `note` in a new Set opens edit mode. Write a table and save: the view renders it.
  - Save the Set, close it and reopen it: `note` shows the same text.
  - Save As under a new name: `note` shows the same note.
  - `e` switches to edit; Esc with changes warns first.
  - With the script off, `note` gives exit 5.
