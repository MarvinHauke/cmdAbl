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

Progress across all plans is tracked in [`STATUS.md`](STATUS.md): what is on which branch, what
waits for a Live test, and known issues. This page is the map: what exists, and what comes next in
which order.

## Where each plan stands (2026-10-22, after 0.1.3)

### Released

| # | Plan | Released in | What exists |
|---|---|---|---|
| [0002](0002-command-feedback-pattern.md) | Command feedback | 0.1.0 | Phases A and C: `CommandResult` with exit codes, one presenter, ✓/× for several targets. Phase B (a lighter message channel) is open. |
| [0003](0003-pakabl-extension-system.md) | pakabl | 0.1.0 | `pakabl install/update/upgrade/list/uninstall` from a curated index. The in-process plugin idea is concluded (blocked on the SDK). |
| [0005](0005-command-tree-and-module-authoring.md) | Command tree, modules | 0.1.0 | The tree, parser, resolver, pick list, modules, authoring guide. Open: completer snapshots for the palette (step 3, needed by 0006). |
| [0007](0007-ui-surfaces.md) | UI surfaces | 0.1.0 | The `Ui` contract, `board` and module pages. Open: themes, replacement pages, `api.ui.register`. |
| [0008](0008-tags-and-aliases.md) | Tags and aliases | 0.1.1 | Tags on tracks, `#tag`, `!#tag`, `--pick`. Open: the store, aliases, history across restarts, tags on chains and pads. |
| [0010](0010-tag-editing.md) | Tag editing | 0.1.2 | Tag board, `tag -e`, `tag -r`. |
| [0011](0011-logging.md) | Logging | 0.1.2 | Core logger, `cmdabl log`, quiet writes with undo lines. |
| [0012](0012-vol-and-dca.md) | `vol` and `dca` | 0.1.3 (`vol`) | `vol` relative and `--set`, `stop`/`--clip` at limits. `dca` is a draft. |
| [0013](0013-set-note.md) | Set note | 0.1.3 | `note`, `note -e`; the Set id in the Set; `api.files`. |
| [0016](0016-test-mcp.md) | Test access for agents | 0.1.3 (dev builds) | `/run`, `/show`, `/log`; MCP tools to run, screenshot and record. |

[0001](0001-path-addressed-objects-and-commands.md) (path-addressed objects) and
[0004](0004-command-platform.md) (the platform umbrella) are mostly built through the plans above.
Still open in 0001: `rm`, a general `select`, `-d`/`-c` flags.

### Next, in dependency order

```
0017 phase 1 script files (run) ──> 0017 phase 2 clip/scene triggers (bridge addition, spike)
0009 `;` action lists ──> 0008 aliases ──> 0017 phase 3 (&&, $1)
0006 step 3 paths level by level ──> device on/off (`bypass`)
0015 link ──┬─> pan / send
            └─> 0012 dca
```

1. **Scripts and triggers** ([0017](0017-scripts-and-triggers.md)), first (user, 2026-10-23):
   `.cmdabl` files run with `run`; then clips and scenes run them on launch, so the Session grid works
   as a matrix of commands. Phase 2 needs a bridge addition (script → cmdAbl), still to be decided.
2. **`;` action lists and aliases** ([0009](0009-ideas-from-clyphx.md), [0008](0008-tags-and-aliases.md));
   the store exists since 0.1.4.
3. **Paths level by level** ([0006](0006-completion-engine.md) step 3): the hierarchy in lists such as
   `mute `; then device on/off as `bypass` (alias `bp`).
4. **`link`** ([0015](0015-link.md)), then `pan`/`send` and **`dca`** ([0012](0012-vol-and-dca.md)).

### Later and ideas

- [0006](0006-completion-engine.md) steps 3–4: hierarchical path completion, ghost text, fuzzy finding (0.2.0).
- [0007](0007-ui-surfaces.md): themes, replacement pages, `api.ui.register`.
- [0008](0008-tags-and-aliases.md): tags on chains and pads (0.2.0).
- [0009](0009-ideas-from-clyphx.md): index/range/`all` targets, snapshots, triggers in clip and locator names.
- [0002](0002-command-feedback-pattern.md) phase B; [0001](0001-path-addressed-objects-and-commands.md) `rm`, `select`, `-d`/`-c`.
- Small items and known issues: see [`STATUS.md`](STATUS.md).

## Hierarchy

```
0004  Command platform (umbrella)
 ├─ 0002  Command feedback pattern
 ├─ 0005  Command tree & module authoring
 │   └─ 0006  Completion engine
 ├─ 0007  UI surfaces
 ├─ 0008  Tags and aliases
 │   ├─ 0010  Tag editing
 │   └─ 0009  Ideas from ClyphX
 ├─ 0011  Logging
 ├─ 0012  vol and dca
 ├─ 0013  note
 ├─ 0015  link (named controls with rules for numeric values)
 ├─ 0016  Test access for agents
 └─ 0017  Scripts and triggers (.cmdabl files, run from clips and scenes)
0001  Path-addressed objects & commands   (consumer of 0004)
0003  pakabl extension system             (consumer of 0005)
```
