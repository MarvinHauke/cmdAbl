# Tags and aliases (0.1.1 and 0.1.2)

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0005](0005-command-tree-and-module-authoring.md) (target resolution, pick list),
[0001](0001-path-addressed-objects-and-commands.md) (Remote Script protocol).

**Status:** 0.1.1 built (2026-10-20: `c91a2c4`, `2166db5`, `9a77e00`), waiting for its Live test — spike done (saved, duplicated, not undoable,
marked modified via `toggle_color`); the spike ops and `tagtest` are being replaced. Tags on tracks ship as
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

1. Is `set_data` saved with the `.als` and restored? — **yes** (user, 2026-10-19: `fx` and a
   JSON list `["fx","drums"]` came back after save and reopen).
2. Is the tag copied when a track is duplicated? — **yes** (the Cmd+D copy of Opal had `fx`;
   the copy and the original then held different values independently).
3. Is `set_data` undoable? — **no** (user, 2026-10-19): Cmd+Z, repeated, never restored the
   old value, also when the write ran inside an undo step (`--undo`). So `tag` must tell the user
   what changed and how to reverse it (e.g. `tag --set 0 /Lead fx`); an own undo is an option.
   Does it mark the Set as modified? — **no** (user, 2026-10-19): after a tag change Live quit
   without asking to save. A tag change alone is lost unless the user saves. Options for the
   design: say "save the Set" in every tag result; or mark the Set dirty with a harmless,
   reverted change (adds undo noise); or keep a copy in cmdAbl's store. The user chose to mark
   the Set. Candidates tested (user, 2026-10-20, script 0.1.4, `tagtest dirty`):

   | Candidate | Undo step | Result |
   |---|---|---|
   | `same_name` (name set to its own value) | no | no effect |
   | `toggle_name` (append/trim a space) | no | Live trims the space, no change |
   | `toggle_color` (`color_index` changed and restored) | **yes** ("Custom Action") | works |
   | `empty_undo` (empty undo step) | no | no effect |
   | `song_data` (`Song.set_data`) | no | no effect |

   Only `toggle_color` creates an undo step. Confirmed (user, 2026-10-20): Live then asks to save
   on close, and one Cmd+Z undoes only the invisible "Custom Action", the colour stays.
   **Decision:** every tag write marks the Set with `toggle_color` on the same track, inside the
   same script op; the `tag` result names the reverse command, since Cmd+Z cannot undo the tag.
4. Size and type limits (store one JSON string).
   Rename (user, 2026-10-20): tags stay with the renamed track (`Lead` → `test` kept `#drums
   #lead`) — the name check only drops a cached entry until the next read. Return and main
   tracks hold tags too.
5. `!#x` (built `bd2e3df`): a track whose tags are unknown (skipped by `tags_all`, or its name
   check failed) counts as untagged, so `!#x` errs wide — later: the cache marks unreadable
   tracks and `!#` leaves them out. "Every regular track" includes a group and its children, so
   `mute !#drums` mutes both — to decide after the Live test whether children of a hit group
   are left out.

## 0.1.1 build split (architect, 2026-10-20)

- **cmdabl-bridge** — script ops `tags_all` (every track's `route`, `name`, `tags`) and
  `tags_set` (`route`, `expectName`, `tags`: writes `cmdabl.tags`, then `toggle_color` on that
  track; returns the stored tags). Regular and return tracks (main if the API allows). Removes
  `track_tags`, `track_tags_set`, `mark_modified`; script version 0.1.3 (main has 0.1.2). TS:
  `ObjectNode.tags?: string[]` on tracks, filled from a background `tags_all` cache like chain
  names and refreshed after a write; `bridgeOps` read/write helpers that never throw.
- **cmdabl-core** — resolver: `#fx` = every node whose `tags` contain `fx` (no pick list; none →
  exit 3); bare `#` = multi-select pick list of the Set's tags with counts; a bare word also adds
  tagged nodes to its pick list. Script not running → `#…` answers exit 5. Pick rows show `#tags`.
- **cmdabl-modules** — `tag` command per the grammar above; removes `tagtest`. Names normalised
  (lowercase, `[a-z0-9_-]`, invalid → exit 2). Result lists what changed and the reverse command.
- Deferred to a later 0.1.x: the "new: <text>" pick-list row (a `Ui` contract change); in 0.1.1
  a new tag is created by typing it (`tag /Lead newtag`).

### Decisions during 0.1.1 (2026-10-20)

- **ModuleApi (user approved, additive):** `api.pickTags(...)` (the tag pick list with state
  buttons, same list core uses for bare `#`) and `api.tags` (`refresh`, `of(node)`, `write(node,
  tags)`) wired to the bridge's tag cache; modules never import `src/ableton/tagCache`
  (architecture rule 5 extended).
- **`#…` fans out** (gives every tagged object at once) for every path argument except `rest`
  arguments and destructive commands, where several hits ask; single-target commands such as
  `goto` ask. A fuzzy bare word still asks. `tag` does not declare `multiple: "all"`.
- **Acting on a tag never asks** (user, after the 0.1.1 Live test): a bare word that is exactly a
  tag name and matches no track name acts like `#word` (all tagged tracks at once); `#fx, #drums`
  takes the union without a list. A list only on a real conflict: the word is a tag and also
  matches track names (tagged rows first), or it only matches a tag partly. `goto` and
  destructive commands still ask (they take one object / need care). `mute #` and `tag <target>`
  keep their lists (choosing, assigning). History keeps the word as typed.
- **`--pick`** (user, 2026-10-20): a platform option on every command with path arguments that
  forces the pick list over all matches of each target, tags included (`mute drums --pick`,
  `mute #fx --pick`): no preselection, the user marks. Only the chosen tracks run; history
  stores the typed line including `--pick`, so a re-run opens the list again. Rest arguments and
  destructive commands get a single-select list. Built in `85ad442`.
- **`!#drums`** (user, 2026-10-20) = every track the argument accepts without the tag `drums`,
  untagged ones included, at once (same exceptions as `#…`); never the main track, return tracks
  only by path. Works in every command (`tag --set 1 !#drums synth`, `mute !#drums, /Lead`) and
  with `--pick`; none → exit 3; script down → exit 5; history keeps it as typed. Intersections
  (`#fx&!#drums`) only if wanted later; a comma stays a union.
- **History keeps `#fx`** as typed, so a re-run hits the tracks tagged now.
- **`tag`'s target is one token** in 0.1.1 (`/Lead`, `"SH-101 MIDI"`, `#drum`, `#`); a comma list
  before tag words is not supported yet (`tag /Lead, /Bass fx` → exit 2).
- **Script version 0.1.5** on this branch (0.1.3/0.1.4 were spike builds; setup compares versions
  for equality, so a fresh number avoids "current" for a spike script).

## Later idea: tags in track names (user, 2026-10-20)

`Lead [#fx, #drums]`: visible in Live, editable by hand, Cmd+Z works, Live marks the Set itself,
and the SDK can read it without the Remote Script. Costs: long names in narrow headers, the
suffix shows in exported stems and on control surfaces, every name match must ignore `[#…]`.
Shape: a setting (needs the 0.1.2 store) `tags.inName = off | mirror` — `mirror` writes
`set_data` and the suffix; a hand-edited suffix wins on read. Spike first: can the extension set
a track name, and is that undoable.

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
