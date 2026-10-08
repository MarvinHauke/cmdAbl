# Command platform — command tree, completion engine, feedback

**Status:** Draft (2026-10-08) — umbrella plan. Triggered by wanting an autocompletion engine
for registered commands, which turned out to require a strict command/subcommand structure and
one result type first; both are prerequisites, so they are planned together and built in order.

## Children

```
0004  Command platform (this plan)
 ├─ 0002  Structured command-feedback pattern   — one result type + one rendering policy
 ├─ 0005  Command tree & module authoring        — strict hierarchy, registration API, docs
 └─ 0006  Completion engine                      — client-side engine over the tree
```

Related but separate: [0001](0001-path-addressed-objects-and-commands.md) provides *path
arguments* and the `rm`/`select` commands, which are built on top of this platform;
[0003](0003-pakabl-extension-system.md) is a consumer (its subcommands migrate).

| Child | Status | Needed for |
|---|---|---|
| [0002](0002-command-feedback-pattern.md) Phase A | Draft | Handler return type (`CommandResult`) — must exist before 0005 fixes the handler contract |
| [0005](0005-command-tree-and-module-authoring.md) | Draft | Everything below: the tree is what completion walks |
| [0006](0006-completion-engine.md) | Draft | Replaces the flat fuzzy palette |

## Context

Today a command is `register(name, description, flags?, handler(flags: string[]))`
(`src/commandRegistry.ts`). There is no notion of subcommands or argument types, so every
command parses its own raw tokens:

- `mute`/`solo` (`src/modules/trackToggleCommand.ts`) join the tokens and split on commas.
- `pakabl` (`src/modules/pakabl/index.ts`) branches on the first token in an `if/else` chain.
- `cmdabl --setup` / `--help` use flags as if they were subcommands.

The palette (`ui/interface.html`) has three phases — `command` (fuzzy), `flag`, and `args`
(no completion at all). Because the webview can only hand the host a single string when it
closes (`close_and_send`), completion cannot call back into the extension while the user types:
it has to run entirely in the webview from data serialized when the palette opens.

Feedback is a mix of `showFeedback`, `console.*` and `throw` (see 0002).

"Done" for this plan: every command is declared in one tree, parsed once by the platform,
returns one result type, and the palette completes any position in any command from that tree.

## Goals / Non-goals

**Goals**
- One declarative command tree with a strict hierarchy (0005).
- Modules only *declare* commands, arguments and candidate data; they never parse raw input.
- One result type and one rendering policy (0002).
- A completion engine that is driven only by the tree plus snapshots (0006).
- A written, short "how to add a command / module" guide (deliverable of 0005).
- Migrate existing commands, with deprecated aliases for old spellings.

**Non-goals**
- Third-party extensions contributing commands (blocked on the SDK — see 0003). The node format
  is serializable data so this stays possible later.
- New Live-object commands (`rm`, `select`, chains, `find`) — they are *consumers* of this
  platform and stay in 0001 / a future `find` plan.

## Principles

1. **One declarative tree.** The tree is the single source of truth for execution, help and
   completion.
2. **Strict hierarchy.** A node is either a group (has children) or a leaf (runs). No node is both.
3. **Modules never parse.** The platform tokenizes and parses; handlers receive a typed invocation.
4. **One result type.** Handlers return `CommandResult`; the platform renders it.
5. **Serializable.** Everything the webview needs is plain JSON.
6. **Migrate, don't break.** Old spellings keep working for a release behind aliases.

## Migration inventory

| Today | Target | Notes |
|---|---|---|
| `cmdabl --setup`, `cmdabl --help` | `cmdabl setup`; `--help` is the universal option on every node | Old `--setup` kept as a deprecated alias for one release |
| `pakabl install <id>` … `list` | Group `pakabl` with leaf subcommands and typed args (`<id>` enum from the index, `upgrade <id>@<version>`) | Replaces the `if/else` in `pakabl/index.ts` |
| `mute` / `solo` `<path>[, <path>]` | Leaves with a variadic `path` argument | Multi-target syntax is an open question (below) |
| `goto` provider + `select` result handler | `goto <path>` leaf (the provider supplies path candidates) | `find` reuses it later |
| `history` entries | Stay a provider; re-run goes through the normal parser | No new syntax |
| `spike-run-track-creator` | Remove or hide behind a dev option | Blocked spike, see 0003 Step 0 |
| `help` | Generated from the tree | |

## Phased rollout

1. **0002 Phase A** — `CommandResult` plumbing (`src/types.ts`, `commandRegistry.ts`, `dispatch()`).
2. **0005** — tree + registration API, with an adapter so old `register(...)` calls keep working.
3. **Migrate** commands one small PR at a time (table above); delete the adapter when empty.
4. **0006** — tree-aware dropdown first, then ghost text and hierarchical path completion.
5. **0001 Phase 3/4** (`rm`, `select`, `-d/-c`, chains) and `find` on the new API.

Each step is shippable alone; steps 2 and 3 keep every existing command working.

## Open questions

- **Multi-target syntax**: comma-separated (today's `mute /a, /b`) vs. variadic arguments with
  quoting (0001 §4). Pick one for the whole platform; recommended: variadic + quotes, with the
  comma form accepted as an alias.
- **Aliases / short names** (`m` for `mute`): allowed in the node format; none defined yet.
- **Deprecation window** for `cmdabl --setup`.
- **Help**: generate a `help <command>` view from the tree, or rely on `--help` only?

## Verification

Per phase, in the child plans. Cross-cutting: after each migration PR, every command listed
in the inventory still runs from the palette with its old spelling and its new one, and
`npm run build` passes.
