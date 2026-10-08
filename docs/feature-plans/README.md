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

## Hierarchy

```
0004  Command platform (umbrella)
 ├─ 0002  Structured command-feedback pattern
 ├─ 0005  Command tree & module authoring
 └─ 0006  Completion engine
0001  Path-addressed objects & commands   (consumer of 0004: path arguments, rm/select)
0003  pakabl extension system             (consumer of 0005: subcommands migrate)
```

Build order: 0002 Phase A → 0005 → migrate commands → 0006 → 0001 Phase 3/4.

## Index

| # | Title | Status | Summary |
|---|---|---|---|
| [0001](0001-path-addressed-objects-and-commands.md) | Path-addressed objects & Linux-style commands | In Progress | Address any Live object (tracks, devices, Drum Rack chains, …) by path (`/vermona/kick`), drive them with Linux-style commands (`mute`, `rm`, `select`, …) supporting flags and multiple targets, and a bidirectional bridge so the palette can read data the Extensions SDK doesn't expose. Phase 2 (tree + path resolution) and a slice of Phase 3 (`mute`/`solo` multi-target) have shipped; `rm`, generalized `select`, `-d`/`-c` flags, and Phase 4 (chains + bidirectional bridge) remain. |
| [0002](0002-command-feedback-pattern.md) | Structured command-feedback pattern | Draft | Give every command a structured, exit-code-like result (`CommandResult`) rendered through one consistent policy — replacing today's scattered modal/console/throw mix — and generalize it to multi-target commands' partial-success reporting. Not yet started; `mute`/`solo` landing makes its "partial success is normal" trigger condition live. |
| [0003](0003-pakabl-extension-system.md) | pakabl — extension/package system | In Progress (pivoted) | Originally planned as in-process loading of third-party code through a `CmdAblAPI` facade over `CommandRegistry`/`Provider`. What shipped instead: `pakabl install/update/upgrade/list/uninstall` downloads and unpacks independently-built `.ablx` packages from a curated index (`pakabl/index.json`) — a simpler, separate-process model that sidesteps the runtime-code-loading question entirely. |
| [0004](0004-command-platform.md) | Command platform (umbrella) | Draft | Umbrella for a declarative command tree, one result type and a completion engine; lists the migration of existing commands and the build order of its children (0002, 0005, 0006). |
| [0005](0005-command-tree-and-module-authoring.md) | Command tree & module authoring | Draft | Strict command → subcommand → option/argument hierarchy (POSIX/GNU style), platform-owned parsing, registration API with validation, completer snapshots, and the module-authoring concept that will become a guide. Parent: 0004. |
| [0006](0006-completion-engine.md) | Completion engine | Draft | Client-side, tree-driven completion for every token position: Tab descends one level, ghost text for the best match, fuzzy search scoped to the current level. Replaces the flat fuzzy palette. Parent: 0004. |
