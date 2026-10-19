# Tags and aliases (0.2.0)

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0005](0005-command-tree-and-module-authoring.md) (target resolution, pick list),
[0001](0001-path-addressed-objects-and-commands.md) (Remote Script protocol).

**Status:** Draft — direction decided by the user on 2026-10-19; the storage spike runs first.

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
- **Aliases** are stored in cmdAbl's own store (`~/Library/Application Support/Ableton/
  Extensions Data/marvinhauke.cmdabl/`), not in the Set — they are the user's, not the project's.

## Design (draft)

### Tags
- Commands: `tag add <target>… <tag>…`? — exact grammar to settle: proposal
  `tag <target> +fx +synth -drum` (add/remove in one line), `tag list [<target>]` (tags of a
  target, or every tag in the Set with its objects), `tag clear <target>`.
- Names: lowercase, letters/digits/`-`/`_`; `#` is the sign, not part of the name.
- Storage: one JSON string per track under `cmdabl.tags`. Chains and pads (no own storage) as a
  map inside their track's value, keyed by route + name and dropped when the name no longer
  matches (same stale rule as `expectName`). Phase 1 = tracks only.
- Reading: one script op returns all tags of the Set (cached like chains); `#fx` resolves
  against it. Without the script: `#fx` answers "not running" (exit 5), bare words work as
  today without tag rows.
- The pick list shows a row's tags next to its kind.

### Aliases
- `alias <name> "<command line>"`, `alias` lists, `unalias <name>`.
- Expanded as the first word before parsing; arguments typed after the alias are appended
  (`fxoff` → `mute --set 1 #fx`; `m bass` with `alias m mute` → `mute bass`). No recursion.
- An alias cannot shadow a built-in command. History stores the expanded line.
- Aliases appear in the palette like commands (subtitle: the line they stand for).

### The store
- JSON files in the extension's Extensions Data folder (writable in the installed sandbox),
  written atomically; a broken file is reported once and ignored, never breaks the palette.
- First users: aliases; later the persistent history and settings (0007 "Enter takes the
  cursor row").

## Open questions (spike, Live test)

1. Is `set_data` saved with the `.als` and restored? (docstring says yes)
2. Is the tag copied when a track is duplicated?
3. Is `set_data` undoable, and does it mark the Set as modified? If it does not mark it, a tag
   changed and closed without saving is lost — then cmdAbl must say "save the Set".
4. Size and type limits (store one JSON string).

## Phased rollout

1. Spike: script op `track_tags` get/set, Live test of the open questions.
2. Tags on tracks: `tag` commands, `#tag` targets, tag rows in the pick list.
3. The store and aliases.
4. Tags on chains and pads; persistent history on the store.

## Verification

Unit tests per phase; Live tests with the installed `.ablx` (store path, sandbox) and with a
saved, reopened and duplicated Set.
