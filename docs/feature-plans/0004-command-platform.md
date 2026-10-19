# Command platform — command tree, completion engine, feedback

**Status:** Draft (2026-10-08) — umbrella plan. Triggered by wanting an autocompletion engine
for registered commands, which turned out to require a strict command/subcommand structure and
one result type first; both are prerequisites, so they are planned together and built in order.

## Children

```
0004  Command platform (this plan)
 ├─ 0002  Structured command-feedback pattern   — one result type + one rendering policy
 ├─ 0005  Command tree & module authoring        — strict hierarchy, registration API, docs
 ├─ 0006  Completion engine                      — client-side engine over the tree
 └─ 0007  UI surfaces                            — replaceable palette, pick list, messages
```

Related but separate: [0001](0001-path-addressed-objects-and-commands.md) provides *path
arguments* and the `rm`/`select` commands, which are built on top of this platform;
[0003](0003-pakabl-extension-system.md) is a consumer (its subcommands migrate).

**0.1.0 scope (user, 2026-10-11):** the rest of 0005 and the Remote Script replies of 0001
Phase 4 are part of 0.1.0; 0006 comes after it. The ordered roadmap is in
[`STATUS.md`](STATUS.md), "Roadmap to 0.1.0".

| Child | Status | Needed for |
|---|---|---|
| [0002](0002-command-feedback-pattern.md) Phase A | Shipped (B/C open) | Handler return type (`CommandResult`) — must exist before 0005 fixes the handler contract |
| [0005](0005-command-tree-and-module-authoring.md) | In Progress (parser, tree registration, resolver, pick list; `goto`/`mute`/`solo`/`arm`/`find` migrated) | Everything below: the tree is what completion walks |
| [0006](0006-completion-engine.md) | Draft — after 0.1.0 | Replaces the flat fuzzy palette |
| [0007](0007-ui-surfaces.md) | In Progress (contract shipped) | Lets the UI be themed or replaced without touching core or modules |

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

## What the core consists of

Updated 2026-10-11 as the pieces landed. Core is what must always be present:

- extension entry + context-menu entries, HTTP trigger server
- command registry, tokenizer, parser (`src/core/`)
- **resolver** — path arguments become Live objects before a handler runs (`resolveArgs.ts`,
  `src/ableton/resolvePath.ts`, the object tree)
- **pick list** — the platform's answer to an ambiguous address (`pick.ts`)
- **UI contract** — `prompt` / `select` / `notify` (`ui.ts`, plan 0007) with the default pages
- result presenter, module manifest
- two commands: `help`, `cmdabl`

Everything else is a module (`src/modules/index.ts`).

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
| `mute` / `solo` `<path>[, <path>]` | `mute`/`unmute`, `solo`/`unsolo` leaves with a variadic `path` argument (`multiple: "all"`); `mute`/`solo`/`arm` toggle per track, the `un…` forms always switch off | Multi-target syntax is an open question (below); "set, not toggle" was reversed by the user on 2026-10-11 (0005) |
| `goto` provider + `select` result handler | `goto <path>` leaf (the provider supplies path candidates) | `find` reuses it later |
| `history` entries | Stay a provider; re-run goes through the normal parser | No new syntax |
| `spike-run-track-creator` | Remove or hide behind a dev option | Blocked spike, see 0003 Step 0 |
| `help` | Generated from the tree | |

## Decisions from the external review (2026-10-11)

A ChatGPT proposal ("POSIX-style contracts") was compared with this architecture. It mostly
restates it; what changed:

| Decision | Items |
|---|---|
| **Adopt** | resolve-before-handler (0005 §2b); result codes; handlers return results, only the platform renders; `multiple: one\|all` per argument; destructive commands only with `one`; resolver + object tree are core; bridge protocol with request id, timeout (≥300 ms, `update_display` runs ~10 Hz), `hello` with protocol version `v` and op list; history as module; "swap a command without touching palette/dispatcher/bridge" as acceptance test |
| **Adopt, modified** | capabilities → coarse `requires: ["bridge"]`; revalidation → `select {route, expectName}` compare-and-set in the Remote Script; unavailable (code 5, no `hello`) vs. unknown end state (code 1, timeout after sending); ~~set-not-toggle commands~~ (reversed 2026-10-11, see 0005); `runOverTargets` inside `withinTransaction` (one undo step, no rollback); contract tests with `node:test` over `tsx` for the pure parts (parser, resolver on a fake tree, `presentResult`, `runOverTargets`, request timeout) |
| **Defer** | typed pipelines (`PipelineValue`, `\|`) until `find` plus a second real chaining workflow exists — keep `CommandResult.details` out of the data channel, a future `value?` is a separate field; **external-process adapter** (use cases are plausible) — keep handlers on ports so it can become a port + module; constraints to check first: the announced stricter OS sandbox, macOS/Windows differences, serializable data exchange |
| **Reject** | fine-grained capability strings + capability registry; `executionId`/`AbortSignal` (the palette is closed while a command runs); `retrySafe` effects metadata; noun-first naming (`tracks mute`); loading/unloading third-party modules at runtime (SDK-blocked, see 0003) |

**Order change:** modules migrate to ports *and* the final parser contract in one pass — 0005
steps 1–3 (types/validator/parser, registration API, tree serialization) land before the
per-module migration, so no module is migrated twice. `cmdabl --setup` becomes `cmdabl setup`
in that pass (old flag kept as a deprecated alias).

Findings about the plans themselves, now fixed or tracked: 0002 mixed `ok` and `code`
(fixed); `Invocation.args` carried raw strings (now resolved values, 0005); `TargetOutcome` had
no per-target code and no place for ambiguity candidates (0002); `ResultHandler` still returns
`void` and `goto` bypasses the result contract (migrates with the module pass; the item
should dispatch `goto <path>`); `findTrackByPath` takes the first substring match silently
(replaced by the resolver, rework step 3); `#n` suffixes are disambiguators resolved at
execution time, not stable identities (identity is LOM route verified via `expectName`).

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
