# `note`: one Markdown note per Set

**Status:** Released in 0.1.3 (2026-10-22, PR #17). Live-tested, including Save As and Collect All
and Save. Next: stamps (timestamped entries, note-1), decided 2026-11-11.
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
  - `api.files.readResult(name)` → `{status: "ok", text} | {status: "missing"} | {status: "failed", reason}`
    (core `7c396c0`, for plan 0018) tells a missing file from a failed read. A module must not write over
    a file whose read failed. `read` delegates to it.
- **Renderer:** the ui agent writes a small renderer of its own (headings, lists, checkboxes, tables,
  code, emphasis, links). It is inlined; no library unless that ends up over about 20 KB.

## Open questions

- ~~Does `Song.set_data` survive saving, reloading, Save As, Collect All?~~ Yes (Live test 2026-10-22).
- ~~Does `Song.set_data` mark the Set as modified?~~ No; `set_id` uses the tags trick.
- Does the SDK know the Set's name or path? It would fill the "last seen as" line.
- The renderer: a library or our own code, and how many kB each costs.
- Later:
  - export the note into the project folder (`<Project>/cmdAbl-note.md`);
  - a table editor;
  - a reminder when the Set opens.

## Stamps: timestamped entries (user finding note-1, decided 2026-11-11; for 0.2.x)

Terms: [GLOSSARY.md](GLOSSARY.md) (stamp, song position). "Stamp" for now (user, 2026-11-11); "mark" with "pick" for pick lists is to discuss again.

**Decisions:**
1. **Keys in view mode:** `e` edits the whole note (as today); **`m` adds a stamp**: a new entry at the end
   of the note, with the text below its heading. `m` then Esc without typing adds nothing.
2. **Stored heading, one fixed format** so stamps can be found again:
   - song running: `### @12.3.1 · 2026-11-11 14:32` (`@` + Live's bar.beat.sixteenth, then date and time);
   - song stopped: `### 2026-11-11 14:32`.
   The song position comes from the Remote Script (`Song.get_current_beats_song_time()` gives "12.3.1.1" directly; the SDK has none). When the
   script doesn't answer, the heading falls back to date and time and the footer says "no song position:
   Remote Script not running". In Session View playback the song position is stamped too.
   A setting **`note.stampStyle`** may later change how a stamp heading looks in view mode, never the
   stored text.
3. **Esc in edit (both `e` and `m`) returns to view and keeps the text;** Esc in view closes and saves. A
   **Discard** button (or Cmd+Z in the text box) throws changes away. This replaces "a second Esc
   discards" (user: he'll report how it feels; a vim mode for the note is a later idea).
4. **Loop while writing:** with **`note.stampLoop`** (default **on**), `m` during Arrangement playback sets
   the arrangement loop to start at the current bar, **`note.loopBars`** long (default 4), and switches it
   on, so the music repeats while typing. Esc puts the loop back as it was (on/off, start, length), and
   playback goes on. If the loop was moved by hand meanwhile, it is left alone. In Session playback the
   loop isn't touched (it doesn't loop clips). Through the Remote Script (`Song.loop`, `loop_start`,
   `loop_length`); the SDK has no Set loop. Accepted: the Set counts as changed (Live asks to save). The Live 13 spike showed the loop write leaves no
   undo step.

**Later:**
- **Jump to a stamp:** Enter or a click on an `@12.3.1` heading in view mode moves Live's playhead there
  (Remote Script, a transport change, not the Set's content); with it `stamp next`/`stamp prev`. Locators
  only if the user wants stamps in the Set.
- **Session stamps** (no key of their own, user 2026-11-11): a stamp made during Session playback is
  linked to the playing scene automatically (Shift+S only if a choice is ever needed); an entry linked to a scene, to jump to that scene. Needs a stable scene
  link that survives rename and move. **Live 13 spike (2026-11-11): `Scene` has no `get_data`/`set_data`**
  (only Song and Track), so the link needs another design (open). Built together with [0017](0017-scripts-and-triggers.md) phase 2,
  which needs the same scene link.
- The old idea "edit mode opens again for a while" was a loop in this sense (decision 4); it is
  replaced by `note.stampLoop`.

**How it is built (architect, 2026-11-11; 0.1.7):**
- **A page never writes**, so `m` can't set the loop itself. `m` in view **closes the page with a stamp
  request**; the module then reads the song position, sets the loop, and opens the page again in stamp
  mode. `note -m` (alias `--stamp`) does the same from the palette.
- **Page answer (note-internal, replaces "" / "\n" / text):** JSON `{"text": string | null, "then":
  "stamp" | null}`. `text: null` = unchanged, `""` = cleared. Page input gains `mode: "stamp"` and
  `stamp: {heading, hint?}`. In stamp mode the page opens in edit with `heading` appended as a new
  last entry and the caret below it. With nothing typed below the heading, the entry is dropped.
- **The heading is built by the module** (one place for the format): position trimmed to three parts
  (`12.3.1`), local `YYYY-MM-DD HH:MM`. Stopped: date only, no hint. No script: date only, hint "no
  song position: Remote Script not running".
- **The loop is restored when the page closes** (not at the first Esc, which only returns to view),
  and only if the current loop still equals the one cmdAbl set. It runs whatever the save does.
- **Session playback** = any track plays a session clip (`playing_slot_index >= 0`): the loop is left
  alone. The bar start uses the Set's current time signature (a limit with signature changes).
- **Bridge (additive, script 0.1.15):** `transport {}` (read, no token) → `{playing, session, pos:
  "12.3.1.1", time, barStart, barLen, loop: {on, start, length}}`, times in beats; `loop_set {on,
  start, length}` (write, token) → `{loop}`.
- **`SetPort` (additive):** `transport(): Promise<Transport | null>` and `setLoop(loop): Promise<Loop |
  null>`; null without the script or on an old one. Never throws.
- **Settings:** `note.stampLoop` (bool, true), `note.loopBars` (int 1–64, 4).

**Stamp after stamp (user finding, 2026-11-11, after the first Live test):** staying in view and
pressing `m` again for the next section must work, and the loop must stop when the stamp's edit ends,
not only when the page closes. Since a page never writes:
- **Esc in stamp edit closes the page with `then: "view"`.** The module saves, restores the loop, and
  reopens the page in view. `m` there starts the next stamp (close, loop, reopen) as usual.
- `then` is `"stamp" | "view" | null`; the module runs the page in a loop until `then` is null.
  The stamp page no longer hides `m`/Stamp. Esc in a plain edit (`e`) still stays in the page; Cmd+S
  saves and closes in both.
- **`stamp` is its own command** in the note module (user, 2026-11-11): `stamp` adds a stamp and
  replaces `note -m` (unreleased, dropped). Later: `stamp next`/`stamp prev` jump the playhead,
  `stamp -l` lists the stamps (a pick list, Enter jumps), with "jump to a stamp" below. A separate
  module can't read the note's file, so `stamp` lives in the note module.

**Without close and reopen (user, 2026-11-11; plan 0018 "Page runs"):** the note page opens as a
live page that may run `stamp loop` and `stamp unloop`:
- `s` in view: the page reads the heading from a route `heading` (transport + format, built by the module),
  runs `stamp loop` and switches to stamp edit in place. Esc in stamp edit runs `stamp unloop` and
  returns to view in place. No flicker, no lost keys.
- `stamp loop` sets the stamp loop at the current bar (`note.loopBars`, Arrangement only, `note.stampLoop`)
  and remembers the old loop; `stamp unloop` restores it if it is still the one set. Both also work by hand.
  When the page closes, the module still restores a loop it set (safety net).
- The text is still saved when the page closes (Cmd+S or Esc in view). Without the server the page
  falls back to `then` and close/reopen (above).

**Key `s` (user, 2026-11-11):** a stamp is added with **`s`** in view (was `m`; read `m` as `s` above).

**Rollout:** cmdabl-bridge (the two ops, tests, script 0.1.15), cmdabl-core (`SetPort`),
cmdabl-modules (settings, `-m`, the heading, the loop and restore), cmdabl-ui (stamp mode, `m`, the
Esc change, Discard, the hint; browser-checked), cmdabl-docs (using.md). Gear on the note page with
0019 phase 6.

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
  - `e` switches to edit; Esc returns to view and keeps the text; Discard with changes asks once.
  - With the script off, `note` gives exit 5.
