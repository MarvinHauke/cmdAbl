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

## Where each plan stands (2026-11-13, after 0.1.8)

### Released

| # | Plan | Released in | What exists |
|---|---|---|---|
| [0002](0002-command-feedback-pattern.md) | Command feedback | 0.1.0 | Phases A and C: `CommandResult` with exit codes, one presenter, ✓/× for several targets. Phase B (a lighter message channel) is open. |
| [0003](0003-pakabl-extension-system.md) | pakabl | 0.1.0, 0.1.8 | `pakabl install/update/upgrade/list/uninstall` from a curated index; stars and downloads in `pakabl list` (0.1.8, daily from `pakabl-data`). The in-process plugin idea is concluded (blocked on the SDK). |
| [0005](0005-command-tree-and-module-authoring.md) | Command tree, modules | 0.1.0 | The tree, parser, resolver, pick list, modules, authoring guide, completer snapshots (0.1.4). |
| [0007](0007-ui-surfaces.md) | UI surfaces | 0.1.0 | The `Ui` contract and module pages (the `board` surface was removed in 0.1.8; the tag editor is a module page). Open: themes, replacement pages, `api.ui.register`. |
| [0008](0008-tags-and-aliases.md) | Tags and aliases | 0.1.1 | Tags on tracks, `#tag`, `!#tag`, `--pick`. Open: the store, aliases, history across restarts, tags on chains and pads. |
| [0010](0010-tag-editing.md) | Tag editing | 0.1.2, 0.1.5, 0.1.8 | The tag list (`tag -l`, Enter runs a line) and the tag editor (list and grid, filter, ⌘R rename, remove, Apply); `tag -r`. The board is gone (0.1.8). Open: undo for tags. |
| [0011](0011-logging.md) | Logging | 0.1.2 | Core logger, `cmdabl log`, quiet writes with undo lines. |
| [0012](0012-vol-and-dca.md) | `vol` and `dca` | 0.1.3 (`vol`) | `vol` relative and `--set`, `stop`/`--clip` at limits. `dca` is a draft. |
| [0013](0013-set-note.md) | Set note | 0.1.3, 0.1.7 | `note`, `note -e`; the Set id in the Set; `api.files`; stamps (`note stamp`, key `s`, in place, loop while writing). |
| [0016](0016-test-mcp.md) | Test access for agents | 0.1.3 (dev builds) | `/run`, `/show`, `/log`; MCP tools to run, screenshot and record. |
| [0006](0006-completion-engine.md) | Completion engine | 0.1.4 (steps 1–2) | Argument completion at every position, completers for modules, the palette switch Off · Hints · Options; the silent-tag row (0.1.5). Open: paths level by level (step 3), ghost text for the best word (step 4), the server variant. |
| [0017](0017-scripts-and-triggers.md) | Scripts and triggers | 0.1.5 (`;` chains) | Several commands in one line, one undo step per part; `|` reserved. Open: script files (`run`), clip and scene triggers. |
| [0018](0018-midi-mapping.md) | MIDI mapping | 0.1.5 (trigger mode) | `map`, `map learn`, `midi monitor`, operators `press`/`release`/`hold`/`toggle`, live pages, Cmd+M warnings; the monitor's status and window renewal (0.1.8). Open: value mode, bindings that open a page, the matrix. |
| [0019](0019-settings-and-help.md) | Settings and help | 0.1.6, 0.1.7, 0.1.8 | `cmdabl config`, `<command> config`, declared settings, default commands and the defaults page, the help line, the palette footer; `listnav.js` (0.1.7); one footer button rule, the shared discard bar `ui/confirm.js`, wrapped choice rows (0.1.8). Open: shortcuts (`Cmd+,`). |
| [0021](0021-installation-and-setup-page.md) | Setup page | 0.1.6 | `cmdabl setup` status rows, Copy/Update, `setup.autoScript`, Karabiner import link, Open Karabiner, Restart Live (macOS). |
| [0023](0023-codebase-layout.md) | Codebase layout | 0.1.6 | `src/core/` in area folders, `modules/shared/`. |
| [0026](0026-loop.md) | `loop` | 0.1.7 | `loop`, `loop here [bars]`, `loop on/off`, `loop back`; used by the note page. |
| [0027](0027-jump.md) | `jump` | 0.1.7, 0.1.8 | `jump` forms, `note stamp list/next/prev`, `note.stampWrap`, `api.pickRows`; `jump.step` from Live's launch quantization (0.1.8). Open: wrap at the end of the Set. |
| [0028](0028-inner-runs.md) | Inner runs | 0.1.8 | `api.commands.run`, `runs`/`outside` on commands; page runs on the same engine (depth 1). |

[0001](0001-path-addressed-objects-and-commands.md) (path-addressed objects) and
[0004](0004-command-platform.md) (the platform umbrella) are mostly built through the plans above.
Still open in 0001: `rm`, a general `select`, `-d`/`-c` flags.

### Next, in dependency order

```
0019 phase 7 shortcuts ──> 0006 keymap
0017 phase 1 script module (global first) ──> 0017 phase 2 clip/scene triggers (uses 0018's UDP push)
0018 value mode ──┬─> 0015 link ──┬─> pan / send
                  │               └─> 0012 dca
                  └─> 0024 param ──> 0025 morph
0019 §7 default commands (built) ──> 0020 aliases ──> 0017 phase 3 (&&, $1, substitution)
0006 step 3 paths level by level ──> device on/off (`bypass`)
```

1. **0.1.9: the setup page shows cmdAbl's own version** ([0021](0021-installation-and-setup-page.md)), then **the `script` module** ([0017](0017-scripts-and-triggers.md) phase 1): global scripts first, `script
   <name>`; then clips and scenes run them (phase 2).
2. **Spike: MIDI outside Live** ([0018](0018-midi-mapping.md)): receivemidi, sendmidi and routemidi (Cmd+M controls,
   relative encoders, LEDs); feeds value mode, 0025.
3. **Shortcuts** ([0019](0019-settings-and-help.md) phase 7), then 0006's keymap.
4. **MIDI value mode** ([0018](0018-midi-mapping.md)): `map learn | vol #synth`; then **`param`**
   ([0024](0024-param.md), draft) and the **morph** ([0025](0025-morph.md), draft; pickup and control types open).
5. **Aliases** ([0020](0020-aliases.md), draft): an `alias` module on 0019's expansion step.
6. **Paths level by level** ([0006](0006-completion-engine.md) step 3); then `bypass` (alias `bp`).
7. **`link`** ([0015](0015-link.md)), then `pan`/`send` and **`dca`** ([0012](0012-vol-and-dca.md)).
8. **Track colors** (a `color` module, plan 0022 to write; STATUS backlog).

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
 ├─ 0017  Scripts and triggers (.cmdabl files, run from clips and scenes)
 ├─ 0018  MIDI mapping (map, midi; operators; later value mode and the matrix)
 │   ├─ 0024  param (Live device parameters by name; draft)
 │   └─ 0025  Morph (morph groups on a master fader; draft)
 ├─ 0019  Settings and help pattern (released 0.1.6–0.1.8; open: shortcuts)
 ├─ 0020  Aliases (the alias module)
 ├─ 0021  Installation and setup page (released 0.1.6)
 ├─ 0023  Codebase layout (released 0.1.6)
 ├─ 0026  loop (released 0.1.7)
 ├─ 0027  jump (released 0.1.7, 0.1.8)
 └─ 0028  Inner runs (released 0.1.8)
0001  Path-addressed objects & commands   (consumer of 0004)
0003  pakabl extension system             (consumer of 0005)
```
