# Settings and help pattern

**Status:** In Progress (2026-11-05, phase 1a). The 0.1.6 theme. User findings from 2026-11-04 (tag-1, tag-4, prompt-1,
prompt-2, note-1's option), the settings page wish (user, 2026-10-22) and the setup status page
(user, 2026-11-05).

**Contract approvals (user, 2026-11-05):**
1. **The `settings` surface (§2):** approved as drafted.
2. **`api.settings` (§1):** approved as drafted.
3. **Argument and option descriptions in the completion snapshot (§4):** approved. The help view's look
   and behaviour in the palette still need refining with the user, because the hints and options modes
   aren't right yet. Build the data first, and agree on the layout with the user before building it out.
4. **Status rows with buttons in `notify` (§6):** not approved yet. The user likes the style, but it needs
   refining, especially for the installation process. It stays open and is decided together with the
   "simpler installation" backlog item.

**Phase 1 refined with the user (2026-11-05, grilling round):** phase 1 is split into 1a (declared
settings) and 1b (default commands); default commands get their own live page instead of rows on the
settings page; a later phase 7 for shortcuts. The decisions are in §1, §2, §7 and "Phased rollout".

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0007](0007-ui-surfaces.md) (surfaces), [0006](0006-completion-engine.md) (the palette's
hint panel, the `settings.json` store)

## Context

- **Settings today:** `src/core/settings.ts` keeps `settings.json` in the extension's data folder with
  three typed keys: `palette.above`, `map.enabled` and `midi.statusBar`. It writes atomically, keeps
  keys it doesn't know and never throws. The only UI is the palette's footer switch
  (Off · Hints · Options), which comes back with the palette's answer. `midi.statusBar` can only be
  changed by editing the file, and the board's fold threshold is a constant (`FOLD_AFTER = 20` in
  `ui/board.html`).
- **Help today:** every page has its own footer text. The board's footer changes with focus, and since
  0.1.5 it changes on hover, without tooltips. The palette's which-key panel (`palette.above = "hints"`)
  lists options but explains nothing.
- **Keys today:** the board has file-tree keys (0010). The pick list and the palette rows have their own
  ↑/↓ handling, and none of them shares code.
- **Setup today:** `cmdabl setup` (`src/core/setup.ts`, `setupAdvice.ts`) answers with text, raw paths
  and URLs.

**Done:** one settings page reachable from everywhere, each module's settings declared once and shown
on it, one help line pattern used by every page, one keyboard model for selection lists, and
`cmdabl setup` as a status page.

## Goals / Non-goals

**Goals**
1. **Settings are declared, not hand-wired.** Core and modules declare their keys with a label, help text,
   kind and default. The settings page is generated from the declarations.
2. **One `settings` surface.** `cmdabl config` shows every group. `<module> config` shows one group
   (`tag config`, `map config`, `note config`). A gear button on a page leads there (tag-1).
3. **One help pattern** (tag-4, prompt-2): a quiet line at the bottom of every page that shows what the
   mouse is over or what has focus, like Live's Info View, and falls back to the page's key line.
   It can be switched off. There are no browser tooltips.
4. **The palette's hint panel becomes a help view** (prompt-2): the recognized command's one-line help,
   the argument at the caret with its description, and the options. The switch moves to the settings
   (prompt-1).
5. **One keyboard model for selection lists:** the board's rules, written down once and shared by the
   pick list, the palette rows and the board.
6. **`cmdabl setup` as a status page:** one row per step with ✓ / ! / ✗, one sentence, and the fix as a
   button.
7. **Default commands** (user, 2026-11-05): a bare command word runs a line set in one file,
   `default_commands.json`, which can be edited by hand or from the "Default command" row at the top of
   each config page (§7).

**Non-goals (deferred, not rejected)**
- Themes and replacement pages (0007 level 1–2). The settings page doesn't edit `theme.css`.
- Settings per Set. Settings stay global for now, and the Set note keeps its own data (0013).
- A keymap editor (0006 "Keymap"). The keyboard model is the base it will bind to.
- A live settings page (0018 live pages). Settings are edited and answered once, like the board.
- Shortening the installation steps themselves (Karabiner, Remote Script copy). This plan only makes
  the result readable. Fewer steps get their own item in the backlog.

## Architecture

### 1. Declared settings (`src/core/settings.ts`, additive ModuleApi part)

```ts
type SettingDef =
  | { key: string; label: string; help: string; kind: "bool"; default: boolean }
  | { key: string; label: string; help: string; kind: "enum"; default: string; choices: { value: string; label: string }[] }
  | { key: string; label: string; help: string; kind: "int"; default: number; min: number; max: number };

interface ModuleApi {
  settings: {
    /** Declare this module's settings (at activation). Keys are `<module>.<name>`; a key outside the module's namespace is a warning and dropped. */
    declare(group: { heading: string; items: SettingDef[] }): void;
    /** The current value (the default when missing or wrong). Never throws. */
    get<T = unknown>(name: string): Promise<T>;
  };
}
```

- The store keeps working on plain keys. Today's `SETTINGS_DEFAULTS` table becomes core's own
  declarations, one group per command so every group id is a command with its `config`
  (2026-11-05, during 1a): `cmdabl` (`palette.above`; `ui.helpLine` in phase 2), `map` "MIDI mapping"
  (`map.enabled`) and `midi` "MIDI monitor" (`midi.statusBar`). The file format doesn't change, and
  existing files stay valid.
- Validation moves from "the default's type" to the declaration: bool, an enum value from `choices`, or
  an int within `min…max`. A wrong value means the default and one warning, as today.
- **Modules don't write settings directly.** Only the settings page changes them, plus core-owned
  shortcuts that exist today (`map --off`). That keeps writes in one place.
- **The first declared keys:**

  | Key | Kind | Default | From | Phase |
  |---|---|---|---|---|
  | `palette.above` | enum off/hints/options | off | prompt-1 (moves from the footer) | 1a |
  | `tag.foldAfter` | int 1–500 | 20 | tag-3 | 1a |
  | `map.enabled` | bool | true | 0018 | 1a |
  | `midi.statusBar` | bool | false | 0018 | 1a |
  | `ui.helpLine` | bool | true | tag-4 | 2 |
  | `note.editLoop` | bool | false | note-1 (with 0013's timestamped entries) | 6 |

  **A key is declared in the phase that gives it an effect** (user, 2026-11-05), so the page never
  shows a switch that does nothing.

  `palette.above`'s label in the page is "Help above the prompt", with values Off · Help · Options
  (see §4). The stored value `"hints"` stays.

### 2. The `settings` surface (new, core, `ui/settings.html`)

| Surface | In | Out |
|---|---|---|
| `settings` | `{ title, focus?: groupId, groups: [{ id, heading, items: [{ key, label, help, kind, value, default, choices?, min?, max? }] }] }` | `{ changes: { [key]: value } }`, or '' when closed |

- One group per declaring module, in the order core, then modules by name. `focus` scrolls to a group
  and puts the cursor on its first row, and `<module> config` sends only that group.
- **Rows:** a bool is a switch, an enum a segmented switch like today's footer switch, and an int a
  number field with − / +. A row whose value differs from the default shows a dim "reset" button.
- **Keys:** ↑/↓ move between rows (§5), ←/→ change an enum or int, Space toggles a bool, Enter
  saves, and Esc leaves without saving: with changes it asks first ("Discard 2 changes?"), like the
  board (user, 2026-11-05).
- **Mouse:** the footer has "Apply (N changes)" (disabled at 0, same as Enter) and "Cancel" (same as
  Esc), like the board (user, 2026-11-05). The footer keeps a fixed height.
- **Link rows:** a row may be a button that leads to another page instead of a value
  (`{ key, label, help, kind: "link", target: "defaults" | "defaults:<command>", summary }`, e.g.
  "Default commands… (3 set)"). It closes the page with `{ changes, open: target }`; core saves the
  changes first, then opens the target. The page renders link rows from 1a on; core adds the first
  ones (the defaults page, §7) in 1b.
- **The help line** (§3) shows the hovered or focused row's `help` text and its default.
- **The answer** is checked by `parseSettingsAnswer` (never throws). Unknown keys, values that don't fit
  and no-ops are dropped. Core then calls `store.set()` after the page closes and answers with one line
  ("2 settings saved"), or exit 1 when the file couldn't be written.
- Capped like the board: 20 groups × 50 items, and texts up to 300 characters.

**Entry points**
- **Naming rule (user, 2026-11-05): `config` is what you type, "Settings" is what you see.** Commands
  say `config` (`cmdabl config`, `tag config`), and the page title and the gear say Settings
  ("cmdAbl Settings", "tag Settings", like Live's own Settings window). The files keep their names
  (`settings.json` since 0.1.4, `default_commands.json`).
- `cmdabl config [<group>]`: a core command, completing group ids. `cmdabl` is a module like the others,
  so this is its `<module> config`, showing every group instead of one.
- `<module> config`: added by the platform to every module with a command, since each config page has at
  least its default-command row (§7). It's a subcommand
  in the tree that the module doesn't write itself, documented in `man` like `--help`.
  **It takes the word `config`:** `tag config` used to address a track named "config" and now opens
  the settings; `tag "config"` keeps the old meaning. The help text and the 0.1.6 release notes say so.
- **The gear reruns the whole line**, so it is only for commands that read and then show a page
  (`tag -l`; `tag -e` is a pick list and has no gear); noted on `BoardRequest.gear`.
- **The gear button** (a text button "Settings", no icon; user 2026-11-05) in a page's footer (board, note, MIDI monitor): a page can't open a second dialog,
  so the gear closes the page with `{ "settings": true }`, and core opens the settings page on that
  module's group. When the settings page closes, core runs the page's command line again, so the user
  is back where they were and sees the change. This holds for Enter and Esc (Esc discards the
  settings changes, the page still comes back; a second Esc on it closes it). A page with pending
  changes asks first ("Discard changes and open settings?"), the same rule as Esc. In 1a the gear is
  on the board and the palette only; `map learn` gets none.
- **The palette's footer switch goes away** (prompt-1, phase 1a). The switch lives on the settings
  page with all three values. **Off is the clean palette:** no gear and no extra footer elements, only
  the prompt and its rows; settings are then reached with `cmdabl config` (later `Cmd+,`, phase 7).
  Hints and Options show the gear. The palette's `settings` answer field stays readable for one
  release and is ignored after that.

### 3. The help line (`ui/help.js`, `ui/shared.css`)

- **Markup:** any element may carry `data-help="…"` (plain text, set with `textContent`). The page
  calls `help.init(lineEl, { idle: () => keyLine })`.
- **Rule:** the line shows the `data-help` of the hovered element, else the focused one, else the
  page's idle text (its keys). Leaving an element returns to the next in that order. There's no delay
  and no animation, the line is one line at most (two on the board, as today), and the footer never
  changes height.
- **Off** (`ui.helpLine = false`): the line shows the idle text only. Pages get the value in their
  request (`help: boolean`, one field every surface takes).
- **Look:** the board's footer as it is (dim text, one line, left-aligned). Proposed improvements for the
  user to judge:
  - the key names in the idle line drawn as small key caps;
  - the subject of a help text in normal weight (`Fold after: tags with more tracks start folded`).
- **Users:** the board (replaces its own footer logic), the settings page, the pick list, the note, the
  MIDI pages and the palette.

### 4. The palette: hints become help (prompt-2)

**Refine before building (user, 2026-11-05):** the snapshot's descriptions are approved. The layout below
is a first proposal. The hints and options modes aren't right yet in the plain palette, so the architect
works the help view out with the user (sketch or browser prototype) before the ui builder builds it.

- The "hints" area above the prompt becomes a **help view**. It stays read-only, and the prompt never
  moves (0006 "Layout without jumping"). It holds:
  1. **the command line:** `tag — show, edit and rename tags` (the command's one-line help);
  2. **the caret's argument:** `<target> — a track path or #tag (several allowed)`, from the `ArgDef`'s
     label and description; for an option waiting for its value, the option's description;
  3. **the options:** the compact grid that exists today, so each option shows its own description in
     the help line when hovered or highlighted.
- **Where it comes from:** the completion snapshot already carries the command tree's help. Each
  argument and option needs a `description` in the snapshot (additive, `CmdComplete`). There's no new
  call while the page is open.
- **The footer** gets the help line (§3). It shows the highlighted row's detail and hovered options,
  and its idle text is the palette's keys.
- **"options" mode** (the selectable zone) stays as it is.

### 5. One keyboard model for selection lists (`ui/listnav.js`)

The rules, from the board (0010, user 2026-11-05):
- From the end of a text field, → enters the list next to it. In a list, ←/→ move along a row and ↑/↓
  move by row. ← on the leftmost item returns to the field.
- Typing in a list returns to the field and types there. Backspace returns and deletes.
- **On pages with sections:** ↑/↓ go between section headings, → goes into a section (unfold, then its
  field), and ← goes out (field → heading → fold).
- Enter takes the item under the cursor, Esc leaves the list (a second Esc clears the field, a third
  closes the page), and Tab completes without taking.

`listnav.js` is a small helper with no DOM assumptions beyond "an ordered list of rows of items". The
pick list and the palette rows move to it first. The board keeps its own code until the helper covers
sections, then switches. Unit tests for the helper run in Node, and the pages are checked in a browser.

### 6. `cmdabl setup` as a status page

**Open (user, 2026-11-05):** the style of status rows is liked, but the contract isn't approved. It needs
refining, especially for the installation process, and is decided together with the "simpler
installation" backlog item. The text below is the starting point.

- `setup` returns `CommandResult.sections` with **status rows**. `notify`'s section items may now be
  `{ text, status?: "ok" | "warn" | "fail", action?: { label, command } | { label, url } }`. Strings
  stay valid (an additive `notify` change).
- **The rows:** Karabiner trigger, Remote Script installed (version), control surface selected, script
  answering, data folder writable. For example, "Remote Script 0.1.14 installed, Live hasn't loaded it
  yet: restart Live once" shows as `!`.
- **An action button** closes the page with `{ "action": [section, item] }`. Core runs the action's
  command line after the page closes (`cmdabl setup karabiner`, `man setup`) or opens the URL. It's
  never a shell command and never an arbitrary string from the page: core looks the action up in the
  result it sent.

### 7. Default commands (`default_commands.json`, user, 2026-11-05)

A bare command word runs a line the user chose: `mute` runs `mute #drums`, `note` runs `note -e`. It works
like an alias for the bare word, for every top-level command (mute, solo, arm, vol, note, tag, find, …).

**One source of truth, two places to edit it:**
- **The file:** `default_commands.json` in the extension's data folder, next to `settings.json`. It's
  plain JSON, one entry per command, and you can edit it by hand:
  ```json
  { "mute": "mute #drums", "note": "note -e", "find": "find -d" }
  ```
- **The defaults page** (`cmdabl config defaults`, user 2026-11-05): its own page, a **live page**
  (0018) with a table: one row per top-level command, the command name, a text field for the line,
  and ✓ or the error next to it. It reads the file when it opens and writes back once when it closes
  (Enter saves, Esc asks when there are changes). The settings page stays a plain page.
  - `cmdabl config` has one link row "Default commands… (3 set)"; every `<module> config` has a link
    row "Default command: mute #drums…" that opens the defaults page focused on that command
    (`cmdabl config defaults mute`). The platform adds these rows, so modules don't declare anything.
  - Keys follow §5: ↑/↓ rows, → into the field, typing edits, Enter saves.
  - Nothing is copied: every view reads and writes the same file. Hand edits (e.g. in nvim) stay a
    first-class way.

**The store** (`src/core/defaultCommands.ts`) uses the same mechanics as `settings.json`:
- it re-reads the file when the file's stamp changed, so a hand edit applies the next time the palette
  opens, without a restart;
- it writes through a temporary file and a rename, keeps entries for commands it doesn't know (a module
  that was removed) and never throws;
- a missing file means no defaults.

**Validation:**
- **While typing (live):** the page asks a read-only route `/check?line=…` (token-bound, only for this
  dialog, 0018 rules) that parses the line against the command tree and answers ok or the usage error.
  Targets are not resolved, so a tag that doesn't exist yet is allowed. The route never writes.
- **After closing (always, and the fallback):** core parses every changed line again. Valid lines are
  saved; if any is invalid, the page reopens on that row with the typed text and the error. This is the
  only check when the local server can't be reached (e.g. its port is taken), so the page works
  without it, as every live page must.
- **On load (hand edits):** an entry that doesn't parse, or doesn't start with its own command, is
  ignored and gets one warning in the log. The config page shows it as invalid, with the text you wrote,
  so you can fix it there.
- **A default must start with its own command.** `mute` → `solo #x` is an alias (0008), not a default.

**Expansion, in core, before parsing.** This is the same step 0008's aliases will use, and modules never
see it:

| Typed | Runs |
|---|---|
| `mute` | `mute #drums` |
| `mute bass` | `mute bass` (anything after the word: no default) |
| `\mute` | `mute` without the default |
| `mute; solo` | each `;` part expands on its own |

- **The palette shows the expansion** while the line is the bare word: one dim row `mute → mute #drums`,
  like the silent tag row (0006). Always compact: the line that will run, not the path to it. Enter
  runs it; Tab writes the expansion into the prompt to edit it.
- **The log line shows what was typed and what ran** (user, 2026-11-05; needed to catch mistakes):
  `run: mute ⇒ mute #drums (default)`. History stores what ran, with the typed form next to it.
- **MIDI bindings expand at each firing** (`map CC48 | mute`), so editing a default changes what the
  control does; `map -l` shows the expansion.
- **Aliases** (0020, later): a default belongs to the root command only. Whether an alias that expands
  to a bare command picks up the default is decided with 0020.
- **Commands that already do something bare** (`note`, `tag`, `history`): the default replaces that
  behaviour, and `\note` brings it back. The config row says so.
- **Not in scope:** subcommands (`midi monitor`) get no defaults.

## Open questions

- **Later: defaults with options only** (user, 2026-11-05: not in v1). `mute --set 1` stays a usage
  error; filling in the default's targets (`mute --set 1 #drums`) may come later.
- **Later: checking inside plain pages.** A page that checks lines itself against the completion
  snapshot (a second parser in the UI) is deferred; the defaults page's live `/check` covers the need.
- **`Cmd+,` for settings** (phase 7): wanted (user, 2026-11-05). Karabiner owns the trigger, and Live may
  take `Cmd+,` before the page sees it. Test in Live first.
- **`ui.helpLine` off:** should it also hide the palette's help view, or only the footer line?
  Proposed: footer only, since the help view has its own switch.
- **Per-window size settings** (0007 "configurable dialog sizes"): would they fit here as `int` keys?
  Probably yes, later.

## Phased rollout

1a. **Declared settings and the settings page:** the `api.settings` part, the `settings` surface
   (link rows rendered, none sent yet), `cmdabl config [<group>]`, `<module> config`, the gear on the board and the palette.
   `tag.foldAfter` replaces `FOLD_AFTER`, and the palette switch moves (Off is the clean palette).
   Only the four 1a keys. Builders: core (store, surface, commands), ui (page), modules (`tag`
   declares).
1b. **Default commands:** first, the gear and the group lookup use the parsed root instead of splitting
   the raw line (1a splits on whitespace, which breaks with `\mute` and aliases). Then `default_commands.json` and its store, the expansion step, `\<command>`, the
   defaults page (live, `/check`, fallback check after closing), the link rows, the palette's
   expansion row with Tab, and the log line `typed ⇒ ran`. Builders: core (store, expansion, route),
   ui (page, palette row).
2. **The help line:** `help.js` on the board, the settings page and the pick list, and `ui.helpLine`.
3. **The palette help view:** descriptions in the snapshot first; the help view and footer line in
   `interface.html` after the layout is agreed with the user.
4. **`listnav.js`** on the pick list and the palette rows, then the board.
5. **The setup status page:** waits for approval 4 and the installation refinement. Then status rows and
   actions in `notify`, and the setup rows.
6. **With 0013:** the note's timestamped entries and `note.editLoop`, gear on the note page.
7. **Shortcuts** (after 0.1.6, user 2026-11-05): `Cmd+,` opens settings, tested in Live first (Karabiner
   and Live may take it), and the start of 0006's keymap for global keys. The list keys stay in §5.

Each phase is released on its own branch state and tested in Live before the next one starts. 0.1.6
ships when phases 1–3 are in. 4–6 may follow as 0.1.7 if they take longer.

## Verification

- **Unit (Node):** the declarations are validated (wrong namespace, bad defaults, duplicate keys);
  `parseSettingsAnswer` (unknown key, out-of-range int, enum outside its choices, no-ops); old
  `settings.json` files load unchanged; a module's `get` returns the default for a broken value;
  `<module> config` exists only for declaring modules (every module with a command gets the
  default-command row, so in practice `config` exists for all of them); default commands: expansion only
  for the bare word, `\mute`, `;` parts, an invalid hand edit ignored with one warning, unknown commands
  kept on write, a line that starts with another command rejected; `listnav` key tables; setup action lookup
  (an action not in the sent result is ignored).
- **Browser (fake requests):** the settings page with every kind, the reset button, Esc with changes,
  the help line on hover and focus, and off; the palette help view for `tag `, `tag -e `,
  `mute #` (no movement of the prompt).
- **Live (MCP, plan 0016):** `cmdabl config` → change `tag.foldAfter` to 3 → `tag -l` folds tags with
  more than 3 tracks; `tag config` opens on the tag group; the gear in `tag -l` → settings → close →
  the board is back; `mute config` → default `mute #drums` → `mute` mutes the #drums tracks, `\mute`
  gives the usage message, and a hand edit of `default_commands.json` applies at the next palette open; `midi.statusBar` on → `midi monitor` writes the status bar; `cmdabl setup`
  with the control surface off shows a ✗ row and its button.
- **By hand (user):** the look of the settings page and the help line, hover behaviour, the palette's
  help view while typing, and whether the gear round-trip feels right.
