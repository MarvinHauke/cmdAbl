# Completion engine

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0005](0005-command-tree-and-module-authoring.md) (the tree and candidate snapshots).

**Status:** Draft (2026-10-08) — replaces the palette's flat fuzzy search with hierarchical,
shell-style completion driven by the command tree.

## Context

`ui/interface.html` has three phases — `command` (Fuse.js over every item, threshold 0.4),
`flag`, and `args` (no completion; Enter passes the literal text). Typing something that
looks like an exact path (`/Sub 37 Midi`) also surfaces loosely related items because
everything is matched in one flat pass. Tab only copies the highlighted item into the input.

The webview cannot call the host while open (it posts one string on close), so the engine runs
entirely client-side over data serialized when the palette opens: the command tree and the
completer snapshots from 0005.

"Done": at every token position the palette offers exactly the valid next things, Tab descends
one level like a shell, and the best single match shows as ghost text.

## Goals / Non-goals

**Goals**
- Complete every position: command → subcommand → options → positional arguments.
- Hierarchical path completion: one segment at a time, Tab descends a level.
- Ghost text for the single best match; dropdown = fuzzy search *within the current level only*.
- Usage hint for the current command (`pakabl install <id>`).

**Non-goals**
- Host-side computation while typing (impossible with the webview channel).
- Changing how commands execute (0005) or report results (0002).
- The `find` command (separate future module that reuses `goto`).

## Architecture

### 1. Inputs (serialized at open)

`{ tree: CommandNode[] (without run), completions: Record<string, Candidate[]>, items: PaletteItem[] }`
where `Candidate = { value, description?, children?: Candidate[] }`; path candidates carry
`children` so descending a level needs no host call.

### 2. Position model

The engine tokenizes the input with the shared tokenizer (0005) and resolves the cursor's token
to one of:

| Position | Candidates | Source |
|---|---|---|
| word 0 | top-level command names + history/Live-object items | tree, providers |
| word n after a group | that group's children | tree |
| token starting with `-` | the leaf's options not yet used (+ `--help`) | tree |
| positional argument i | by `ArgDef.kind` / `complete` key | completers |
| path argument | children of the already-resolved parent segments | path candidates |

### 3. Matching

- Within the candidate set: exact prefix first, then fuzzy (Fuse.js, as today) scoped to that
  set only — never the whole tree.
- Path arguments resolve segment by segment: all but the last segment must match exactly,
  the last is fuzzy-matched against that node's children.
- Names with spaces are auto-quoted when completed.

### 4. Interaction

- **Ghost text**: best match rendered faded after the cursor; `→`/Tab accepts it.
- **Tab** accepts the highlighted candidate and *descends one level* (appends a space after a
  command word, or `/` after a path segment that has children). It never executes.
- **Enter** executes the typed line (parsed by the platform, 0005); with a highlighted
  candidate it first accepts it.
- The existing `mode-badge` shows the current level (`command`, `--option`, `path`).
- A one-line usage hint is built from the leaf's `args`.

### 5. Replaces

`parse()`, `computeItems()`, `resultFor()`, `rawResult()` and the `command|flag|args` modes in
`ui/interface.html`; `PaletteItem.flags` and `FlagDef` become part of the tree (`src/types.ts`).

## Open questions

- Prototype ghost text on a plain `<input>` overlay vs. a `contenteditable`; settle by trying.
- How to order history entries relative to commands at word 0 (today: first rows when the
  query is empty).
- Performance with large Sets (hundreds of paths): precomputed per-level indexes vs. building
  Fuse instances lazily per level.

## Phased rollout

1. **Tree-aware dropdown**: command/subcommand/option completion from the tree (no ghost text).
2. **Argument completion** from completer snapshots (enums such as pakabl ids).
3. **Hierarchical paths**: segment-by-segment completion with `children` candidates.
4. **Ghost text** and the usage hint.

## Verification

- Per phase, in a real Live Set via `npm start`: type `pa` → `pakabl`; `pakabl ` → its
  subcommands; `pakabl install ` → installable ids; `mute /ver` → `/vermona`, Tab → `/vermona/`
  and only its children; `mute -` → only valid options.
- Typing an exact path surfaces that one object, not unrelated fuzzy hits.
- A Set with 300+ tracks stays responsive while typing.
