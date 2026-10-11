# Command tree & module authoring

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0002](0002-command-feedback-pattern.md) Phase A (`CommandResult`).

**Status:** In Progress — rollout step 1 shipped (2026-10-11); drafted 2026-10-08 — defines how commands, subcommands and their arguments are
declared, so parsing, help and completion all derive from one structure.

## Context

`CommandRegistry` (`src/commandRegistry.ts`) stores a flat list of `{name, description, flags}`
and a handler that receives raw `flags: string[]`. `ModuleApi` (`src/modules/types.ts`) exposes
`registry`, `registerProvider`, `registerResultHandler`, `onCommandRun`, `showFeedback`.
Modules therefore invent their own argument syntax. See 0004 for the current-state inventory.

"Done": a module author can add a command or subcommand by declaring a node, and gets parsing,
`--help`, validation errors, completion and history for free; a short guide
(`docs/guides/adding-a-command.md`) documents it.

## Goals / Non-goals

**Goals**
- A strict, documented hierarchy for commands, subcommands, options and arguments.
- Platform-owned tokenizing and parsing; handlers receive a parsed `Invocation`.
- A registration API with ownership/collision rules and startup validation.
- A written module-authoring concept and guide.

**Non-goals**
- Completion UX (0006) and feedback rendering (0002).
- Cross-extension command contribution (SDK-blocked, 0003).

## Architecture

### 1. The model (POSIX/GNU style, as in `git` or `docker`)

```
cmdabl setup                       command → subcommand
pakabl install federico-pepe.snake command → subcommand → positional argument
mute -d /vermona/kick /vermona/snare   command → option → positional (variadic path) arguments
```

- **Bare words** are command and subcommand names.
- **`-x` / `--long`** are options (modifiers). Actions are never flags: `cmdabl setup`, not
  `cmdabl --setup`.
- **`--`** ends option parsing; everything after is positional.
- **`--help` / `-h`** exists implicitly on every node and prints that node's usage.

### 2. Node format (serializable data)

```ts
interface CommandNode {
  name: string;                 // one word, lowercase, [a-z0-9-]
  summary: string;              // one line; shown in the dropdown and in --help
  aliases?: string[];
  children?: CommandNode[];     // group node: not runnable on its own (prints its help)
  options?: OptionDef[];
  args?: ArgDef[];              // leaf node: positional arguments, in order
  requires?: "bridge"[];        // optional companions; checked before the handler (code 5 if absent)
  run?: (inv: Invocation, ports: Ports) => CommandResult | Promise<CommandResult>;   // leaf node only
}

interface OptionDef { name: string; short?: string; takesValue?: boolean; summary: string }
interface ArgDef {
  name: string;
  kind: "path" | "enum" | "text" | "number";
  required?: boolean;           // default true
  variadic?: boolean;           // last argument only
  complete?: string;            // key of a completer registered by a module (see 3)
}
// `args` hold *resolved* values: `path` arguments are already LOM-backed nodes (see 2b), never raw strings.
interface Invocation { path: string[]; options: Record<string, string | true>; args: ResolvedArg[][] }
```

**Rules, checked at registration (violations are startup errors, not runtime surprises):**
1. A node has `children` **or** `run`, never both.
2. Sibling names and aliases are unique; top-level names are owned by exactly one module.
3. Required arguments precede optional ones; only the last argument may be variadic.
4. Option names are unique within a node; `help`/`h` are reserved.
5. Everything except `run` is plain JSON, so the tree can be sent to the webview as is.

### 2b. Path arguments are resolved before the handler runs

An argument of `kind: "path"` is resolved by the platform, never by the module. Resolution
yields zero, one or many matches: zero → `ExitCode.NOT_FOUND`; many → `ExitCode.AMBIGUOUS` with
the candidate paths in `details`, unless the argument declares `multiple: "all"`. Handlers
therefore only ever receive uniquely resolved objects, and `goto`/`mute`/`solo` contain no
ambiguity handling of their own. Identity is the LOM route, not the display name; duplicate
sibling names get a deterministic suffix (`/Drums/Kick`, `/Drums/Kick#2`).

### 3. Candidate data (completers)

An argument names its candidates with `complete: "key"`. Modules register completers, which the
platform calls **when the palette opens** and serializes next to the tree:

```ts
api.commands.completer("pakabl-ids", () => index.map(e => ({ value: e.id, description: e.name })));
api.commands.completer("track-path", ({ live }) => live.listPaths()); // via a port, never the raw context
```

This replaces `registerProvider` for command arguments (providers remain for non-command palette
items such as history and Live objects). Because candidates are a snapshot, they can be stale
for the lifetime of one open palette; that matches today's behavior.

### 4. Registration API (`ModuleApi`)

```ts
api.commands.group("pakabl", "install and manage community extensions", (g) => {
  g.command("install", {
    summary: "download and install an extension",
    args: [{ name: "id", kind: "enum", complete: "pakabl-ids" }],
    run: ({ args }) => install(args[0][0]),
  });
});
```

The old `registry.register(name, description, flags?, handler)` stays during migration as an
adapter that wraps the handler in a leaf node with a single variadic `text` argument.

### 5. Execution path

`dispatch()` (`src/extension.ts`) receives the typed line from the webview → platform tokenizer
→ walk the tree by bare words → parse options and arguments against the matched leaf → validate
(missing/unknown/extra) → `run(invocation)` → render the returned `CommandResult` through
`presentResult()` (0002). Parse and validation failures are `CommandResult`s too (usage text
from the node), never thrown.

### 6. Module authoring concept (becomes the guide)

A module is `activate(api)` and may contribute: **(a)** a command subtree, **(b)** completers,
**(c)** non-command providers/result handlers. Conventions the guide will state: verbs for
actions (`install`, `list`), nouns for groups; one-line lowercase summaries; no output on
success unless it helps; return `CommandResult` instead of calling `showFeedback`; never read
`process.argv`-style raw strings; add a completer for any argument with a closed set of values.

## Open questions

- Tokenizer shared by host and webview: a single TypeScript file bundled into both builds
  (`build.ts` / `vite.config.ts`) — confirm the webview build can import it.
- Option values: `--flag value` and `--flag=value`, or only one?
- Whether `args` should support named groups (e.g. `<from> <to>`) beyond ordered positionals.

## Phased rollout

**Where things stand (2026-10-11):** step 1 is implemented and unit-tested (`npm test`): `src/core/tokenize.ts` (shared tokenizer), `src/core/commandTree.ts` (node types, `validateTree`, `usage`/`helpText`, `serializeTree`), `src/core/parse.ts` (walks the tree, parses options/arguments, returns run / help / error with exit codes). Nothing is wired into `dispatch()` yet — existing commands still run through the old `register()` path. The comma form `mute /a, /b` is not handled by the tokenizer; it stays with the legacy adapter until `mute` is migrated.

1. Types + validator + tokenizer + parser with unit-level checks (no behavior change).
2. `api.commands` registration and the `register()` adapter; `dispatch()` runs through the parser.
3. Serialize tree + completer snapshots into the webview payload (used by 0006).
4. Migrate commands (see 0004 inventory), then remove the adapter.
5. Write `docs/guides/adding-a-command.md` from section 6 once the API is stable.

## Decisions from the external review (2026-10-11)

Taken from comparing a ChatGPT architecture proposal with this plan (full table in
[0004](0004-command-platform.md)):

- `ArgDef.multiple?: "one" | "all"` (default `"one"`) — cardinality of *matches per token*;
  distinct from `variadic` (several tokens). `required: false` allows zero matches. Destructive
  commands (`rm`) must use `"one"`; the registration validator enforces it.
- `requires: ["bridge"]` is the only capability concept: coarse, checked before the handler,
  serialized when the palette opens so unavailable commands can be marked (0006). No capability
  registry, no `executionId`/`AbortSignal`, no `retrySafe`.
- Setting commands over toggles: `mute`/`unmute`, `solo`/`unsolo` (idempotent, history re-runs are
  safe); a toggle remains only as a palette item action.
- **Acceptance criterion:** a command can be added, replaced or removed without touching the
  palette, the dispatcher or the bridge (only a LOM-only op needs a new Remote Script function).
- The node/command contract stays adapter-neutral (handlers use ports, never `child_process`),
  so an external-process adapter can be added later as a port + module (deferred, see 0004).

## Verification

- Registration rejects each rule violation above with a clear startup error.
- `mute -d /a /b`, `pakabl install <id>`, `cmdabl setup` parse to the expected `Invocation`;
  `--help` on a group and on a leaf prints usage; missing/unknown arguments produce a failing
  `CommandResult` with usage.
- Old spellings still work through the adapter or aliases until removed.
