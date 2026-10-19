# Tags and aliases (0.1.1 and 0.1.2)

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0005](0005-command-tree-and-module-authoring.md) (target resolution, pick list),
[0001](0001-path-addressed-objects-and-commands.md) (Remote Script protocol).

**Status:** Draft — direction and grammar decided by the user on 2026-10-19; the storage spike
(`e061b47`, `0fbfe08`, temporary `tagtest`) waits for its Live test. Tags on tracks ship as
0.1.1, the store and aliases as 0.1.2; tags on chains and pads come with 0.2.0.

## Context

After 0.1.0 the user wants to act on groups of objects by meaning rather than by name: the
track "SH-101 MIDI" is tagged `synth, fx`, the pad "Vermona/Multi" `drum, fx`, and `mute #fx`
mutes all of them. Aliases come along: a saved command line, e.g.
`alias fxoff "mute --set 1 #fx"`. Tags say *what* to act on, aliases *how*.

## Decisions (user, 2026-10-19)

- **Tags live in the Live Set**, written by the Remote Script with `Track.set_data` /
  `get_data` (Python API; Track and Song have it, Chain/DrumPad/Device do not — cmdabl-bridge,
  2026-10-19). They travel with the project and survive renames and moves.
- **`#fx`** in a target means every object tagged `fx`, at once, no pick list.
- A **bare word** (`mute fx`) matches names as today and also adds objects tagged `fx` to the
  same pick list, each row tagged `#fx`; the user picks.
- A **bare `#`** as a target opens a multi-select pick list of the Set's tags (with object
  counts); the chosen tags become the targets: `mute #`, `solo #, /Lead`. Resolved by the
  platform, so every command with targets gets it; no `--tag` option.
- **`tag` works like `mute`**: toggle by default, `--set 1|0` to add or remove (see below).
- **Aliases** are stored in cmdAbl's own store (`~/Library/Application Support/Ableton/
  Extensions Data/marvinhauke.cmdabl/`), not in the Set — they are the user's, not the project's.

## Design (draft)

### Tags
- Grammar (same toggle/`--set` model as `mute`/`solo`/`arm`):

  | Line | Does |
  |---|---|
  | `tag /Lead` | pick list of all tags in the Set, each with a state button (lit = the target has it); `Tab` marks, the ring shows the result, `Enter` applies; a new name typed in the filter can be created |
  | `tag /Lead fx synth` | toggles `fx` and `synth` |
  | `tag --set 1 /Lead fx` | adds `fx` |
  | `tag --set 0 #drum fx` | removes `fx` from every track tagged `drum` |
  | `tag` | all tags and their tracks |

  The first argument is the target (a path, a quoted name, `#tag`, `#`, or a comma list such as
  `/Lead, /Bass`); every word after it is a tag name. Rejected: `+fx -drum` (a word starting
  with `-` is an option) and `tag add|remove` subcommands (more typing).
- Open for the UI: the tag state button's icon; creating a tag from the filter text needs a
  "new: <text>" row in the pick list — a contract question, decided when this phase starts.
- Names: lowercase, letters/digits/`-`/`_`; `#` is the sign, not part of the name.
- Storage: one JSON string per track under `cmdabl.tags`. Chains and pads (no own storage) as a
  map inside their track's value, keyed by route + name and dropped when the name no longer
  matches (same stale rule as `expectName`). Phase 1 = tracks only.
- Reading: one script op returns all tags of the Set (cached like chains); `#fx` resolves
  against it. Without the script: `#fx` answers "not running" (exit 5), bare words work as
  today without tag rows.
- The pick list shows a row's tags next to its kind.

### Aliases
- `alias add <name> "<command line>"`, `alias remove <name>`, `alias list` (like `history`).
- Expanded as the first word before parsing; arguments typed after the alias are appended
  (`fxoff` → `mute --set 1 #fx`; `m bass` with `alias m mute` → `mute bass`). No recursion.
- An alias cannot shadow a built-in command. History stores the expanded line.
- Aliases appear in the palette like commands (subtitle: the line they stand for).

### The store
- JSON files in the extension's Extensions Data folder (writable in the installed sandbox),
  written atomically; a broken file is reported once and ignored, never breaks the palette.
- First users: aliases; later the persistent history and settings (0007 "Enter takes the
  cursor row").

## Live 12 browser tags (checked 2026-10-19)

Live 12's own tags belong to browser items (presets, samples, plug-ins, folders), are stored with
the User Library, and the Remote Script API exposes neither them nor a search — only the browser
tree (`children`, `uri`, `is_loadable`), `colors` (Collections) and `load_item` (cmdabl-bridge,
12.3.6 stubs). So they cannot stand in for track tags. Later idea: a `load` command that walks
the browser by Collection colour or by our own tags keyed by `uri`; spike only when wanted.

## Open questions (spike, Live test)

1. Is `set_data` saved with the `.als` and restored? (docstring says yes)
2. Is the tag copied when a track is duplicated?
3. Is `set_data` undoable, and does it mark the Set as modified? If it does not mark it, a tag
   changed and closed without saving is lost — then cmdAbl must say "save the Set".
4. Size and type limits (store one JSON string).

## Phased rollout

1. Spike: script ops `track_tags`/`track_tags_set`, temporary `tagtest`, Live test of the open
   questions. The spike ops, `tagtest` and the script version bump are replaced or removed
   before anything reaches `main`.
2. 0.1.1 — tags on tracks: `tag`, `#tag`, `#`, tag rows in the pick list.
3. 0.1.2 — the store and aliases; history survives restarts.
4. 0.2.0 — tags on chains and pads.

## Verification

Unit tests per phase; Live tests with the installed `.ablx` (store path, sandbox) and with a
saved, reopened and duplicated Set.
