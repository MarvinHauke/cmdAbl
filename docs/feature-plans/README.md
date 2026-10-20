# Feature plans

This folder holds design docs for non-trivial cmdAbl features — written *before* (and updated
during) implementation so the architecture gets thought through once, in writing, rather than
rediscovered in code review or three months later when extending it.

Add a plan here when a feature touches multiple parts of the system (extension ↔ webview ↔
bridge ↔ Remote Script), introduces a new abstraction, or is large enough that "what should
this look like in six months" is worth answering up front. Skip it for bug fixes, copy
tweaks, or single-file changes — those don't need a design doc, just a commit message.

## Conventions

- **Numbering**: `NNNN-kebab-case-title.md`, numbers assigned sequentially in the order plans
  are created (not the order features ship). This gives a stable reading/reference order —
  "see 0001" always points at the same doc.
- **Status**: every plan starts `Draft`, and its front-matter status line is updated as work
  progresses: `Draft → In Progress → Shipped` (or `Superseded by NNNN` if a later plan
  replaces it). Update the table below to match.
- **Hierarchy**: a plan may declare a `**Parent:**` (the umbrella it belongs to) and `**Depends on:**` plans that must land first; the index below shows the tree. Umbrella plans own the roll-up status of their children.
- **Template**: copy [`TEMPLATE.md`](TEMPLATE.md) as a starting point — it lists the section
  headings these plans use and what goes in each.
- **Living documents**: a plan isn't a contract frozen at design time. As implementation
  surfaces new constraints, edit the doc — that's the point of keeping it in the repo next to
  the code instead of in a chat transcript.

Progress across all plans — what is merged, what awaits a test in Live, what is next — is
tracked in [`STATUS.md`](STATUS.md).

## Hierarchy

```
0004  Command platform (umbrella)
 ├─ 0002  Structured command-feedback pattern
 ├─ 0005  Command tree & module authoring
 ├─ 0006  Completion engine
 ├─ 0007  UI surfaces (replaceable palette, pick list, messages)
 ├─ 0008  Tags and aliases (0.1.1, 0.1.2)
 ├─ 0009  Ideas from ClyphX
 └─ 0010  Tag editing (overview editor, one tag on many tracks)
0001  Path-addressed objects & commands   (consumer of 0004: path arguments, rm/select)
0003  pakabl extension system             (consumer of 0005: subcommands migrate)
```

Build order: 0002 Phase A → 0005 → migrate commands → 0006 → 0001 Phase 3/4.

## Index

| # | Title | Status | Summary |
|---|---|---|---|
| [0001](0001-path-addressed-objects-and-commands.md) | Path-addressed objects & Linux-style commands | In Progress | Address any Live object (tracks, devices, Drum Rack chains, …) by path (`/vermona/kick`), drive them with Linux-style commands (`mute`, `rm`, `select`, …) supporting flags and multiple targets, and a bidirectional bridge so the palette can read data the Extensions SDK doesn't expose. Phase 2 (tree + path resolution) and a slice of Phase 3 (`mute`/`solo` multi-target) have shipped; `rm`, generalized `select`, `-d`/`-c` flags, and Phase 4 (chains + bidirectional bridge) remain. |
| [0002](0002-command-feedback-pattern.md) | Structured command-feedback pattern | In Progress (Phase A shipped) | Give every command a structured, exit-code-like result (`CommandResult`) rendered through one consistent policy — replacing today's scattered modal/console/throw mix — and generalize it to multi-target commands' partial-success reporting. Phase A (`CommandResult` with named exit codes, single presenter) is implemented; Phase B/C open. |
| [0003](0003-pakabl-extension-system.md) | pakabl — extension/package system | In Progress (pivoted) | Originally planned as in-process loading of third-party code through a `CmdAblAPI` facade over `CommandRegistry`/`Provider`. What shipped instead: `pakabl install/update/upgrade/list/uninstall` downloads and unpacks independently-built `.ablx` packages from a curated index (`pakabl/index.json`) — a simpler, separate-process model that sidesteps the runtime-code-loading question entirely. |
| [0004](0004-command-platform.md) | Command platform (umbrella) | Draft | Umbrella for a declarative command tree, one result type and a completion engine; lists the migration of existing commands and the build order of its children (0002, 0005, 0006). |
| [0005](0005-command-tree-and-module-authoring.md) | Command tree & module authoring | In Progress (tree registration, resolver and pick list shipped) | Strict command → subcommand → option/argument hierarchy (POSIX/GNU style), platform-owned parsing, registration API with validation, completer snapshots, and the module-authoring concept that will become a guide. Parent: 0004. |
| [0006](0006-completion-engine.md) | Completion engine | Draft | Client-side, tree-driven completion for every token position: Tab descends one level, ghost text for the best match, fuzzy search scoped to the current level. Replaces the flat fuzzy palette. Parent: 0004. |
| [0007](0007-ui-surfaces.md) | UI surfaces | In Progress (contract shipped) | The platform talks to three surfaces — `prompt`, `select`, `notify` — defined by data in / one value out, so the palette, pick list and messages can be themed or replaced (Neovim's `vim.ui.select` idea). Parent: 0004. |
| [0008](0008-tags-and-aliases.md) | Tags and aliases | In Progress (0.1.1 tags shipped; 0.1.2 aliases next) | Tags stored in the Live Set (`mute #fx`, tag rows in the pick list) and aliases as saved command lines in cmdAbl's own store. Parent: 0004. |
| [0009](0009-ideas-from-clyphx.md) | Ideas from ClyphX | Draft | Concepts from the ClyphX action language worth adopting: action lists with `;`, selected/index/range targets, value changes, snapshots, and triggers (commands in clip, locator and pad names). Parent: 0004. |
| [0010](0010-tag-editing.md) | Tag editing | Draft | `tag -l` as an editable overview (click a track to remove its tag, Apply, reopen) on a new generic `board` surface, and `tag --edit <tag>` as a tag-first pick list for one tag on many tracks; also the `ui/` pattern (core surfaces vs module pages). Parent: 0004. |
