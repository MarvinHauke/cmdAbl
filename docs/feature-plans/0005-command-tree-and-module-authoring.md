# Command tree & module authoring

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0002](0002-command-feedback-pattern.md) Phase A (`CommandResult`).

**Status:** In Progress — rollout steps 1–2 and resolve-before-handler shipped (2026-10-11); drafted 2026-10-08 — defines how commands, subcommands and their arguments are
declared, so parsing, help and completion all derive from one structure.

## Context

`CommandRegistry` (`src/commandRegistry.ts`) stores a flat list of `{name, description, flags}`
and a handler that receives raw `flags: string[]`. `ModuleApi` (`src/modules/types.ts`) exposes
`registry`, `registerProvider`, `registerResultHandler`, `onCommandRun`, `showFeedback`.
Modules therefore invent their own argument syntax. See 0004 for the current-state inventory.
(That was the state when this plan was written; `registry` and `registerResultHandler` are
removed since 2026-10-12, see "Phased rollout".)

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

The old `registry.register(name, description, flags?, handler)` adapter is gone since
2026-10-12 (`a3ae115`): every command is a node added with `api.commands.add`, and an unknown
first word always gets the parser's "unknown command" answer.

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

**Update (2026-10-12):** `pakabl` and `cmdabl` are groups on the tree (`e04989d`, `f795ac1`;
no aliases for the old flags), `requires` is built, the legacy `register()` path and
`ModuleApi.registry` are removed (`a3ae115`), the `enum` argument kind exists (`dbcb401`) and
palette object rows run as `goto` (`ee64867`, `1063875`). Left of this plan: ports on
`ModuleApi`, the authoring guide. The older
notes below describe the state before that.

**Update (2026-10-11, later):** step 2 and the resolver are in. `CommandRegistry.add(node)`
(validated, rejects instead of throwing) and `ModuleApi.commands.add`; every typed line goes
through `src/core/run.ts` (`parse` → `resolveArgs` → pick → `run`), with `register()` kept as the
legacy path for `pakabl`, `cmdabl` and `help`. The webview now returns the raw line. Two
`ArgDef` additions came out of real use: `rest` (one value from the remaining words, so
`goto /Opal Lead` needs no quotes) and `kinds` (which object kinds a path may match).
Ambiguous addresses open the **pick list** (`src/core/pick.ts`, `ui/pick.html`): single-select
by default, multi-select when the argument is `variadic`. Migrated: `goto`, `mute`/`unmute`,
`solo`/`unsolo`, new `arm`/`unarm`, new `find`/`next`/`prev`. Not done yet: ports (handlers still
close over `ModuleApi`), `requires` checks, subcommand groups for `pakabl`/`cmdabl`, the guide.

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
- ~~Setting commands over toggles~~ — **reversed by the user after the Live test (2026-10-11):**
  `mute`, `solo` and `arm` toggle each named track individually, as they did before the rework;
  `unmute`, `unsolo` and `unarm` stay and always switch off. Consequence, accepted: re-running
  `solo /a` from history toggles it back.
- **Acceptance criterion:** a command can be added, replaced or removed without touching the
  palette, the dispatcher or the bridge (only a LOM-only op needs a new Remote Script function).
- The node/command contract stays adapter-neutral (handlers use ports, never `child_process`),
  so an external-process adapter can be added later as a port + module (deferred, see 0004).

## Decisions from the Live test of PR #9 (2026-10-11)

- **Live objects as palette items stay.** Typing a track or device name (or path) without `goto`
  and pressing Enter selects it — intended, and what 0006 describes for word 0. It still runs
  through the older route (`goto`'s provider plus `registerResultHandler("select")`), so it
  bypasses `runLine`: no history entry, no `next`/`prev` list. Clean-up with the rest of this
  plan: a chosen object item becomes `goto <unique path>` and takes the normal path; then
  `registerResultHandler` can go (a `ModuleApi` change — ask the user first).
- **The pick list is an interactive filter, built with pipelines in mind.** Objects in, a subset
  of objects out (`pickNodes`); a selection is never passed through the platform as text. Its
  *text form* is the list of unique paths (`uniquePath`), the same form history stores and a
  future pipe would print or pass on. Pipelines themselves stay deferred (0004). Left open on
  purpose: whether `find` inside a pipe passes on all matches or opens the pick list
  (`find … | pick | mute`), and whether a selection can be handed back to the palette to keep
  typing.
- **The pick list shows the command it will run** (see 0007, "Command line in the pick list").
- **The remembered line is fully canonical** (architect, 2026-10-11): `RunOutcome.line` names
  every resolved `path` target by its unique path, quoted where needed, and each object once —
  `mute opal /Opal Lead` is stored as `mute "/Opal Lead"`. `text` arguments and options stay as
  typed. A history re-run therefore never asks and does not change meaning when a later track
  makes `opal` ambiguous. The pick list's preview follows the same rule.
  Known consequence, to decide when the first command uses it: an argument declared
  `multiple: "all"` is remembered as the fixed list of objects it matched at the time, not as
  "everything matching".
- **An option starts with an unquoted dash** (`--to="a b"` is an option, a fully quoted `"--x"`
  is a word), so a remembered line with a spaced option value parses again.
- **Dash rules** (architect, after the review of `972b67a`):
  - `--` ends option parsing for everything after it, `--help` included.
  - A lone `-` is a word, so a track called `Kick - Sub` works unquoted.
  - A positional that starts with a dash is quoted in the remembered line.
  - The parser stays strict otherwise (confirmed by the user, 2026-10-11): `mute /Bass -6dB` is "unknown option `-6dB`" and needs
    quotes or `--`; the error says so. Letting path arguments swallow unknown dash-words would
    turn typos into "nothing matches". *Deferred, not rejected* — revisit with completion
    (0006), which quotes names for the user.
  - Combined shorts (`-dt`) are not supported. Deferred until a command has shorts that are
    used together (`find -t|-d` are alternatives).
  - An unquoted `-1` is an unknown option; a negative value needs quotes or `--`. Decide
    whether numbers get a special case when the first `number` argument exists, and say it in
    the authoring guide.

## Toggle by default, `--set` to force (user, 2026-10-12)

`mute`, `solo` and `arm` toggle each target; `-s, --set <0|1>` forces the state, where the value
is the state the command is named after (1 = muted / soloed / armed), as in the LOM. The
separate `unmute`, `unsolo`, `unarm` commands are removed without aliases. A remembered line
keeps the option, so re-running it is deterministic. Pattern for later commands: one command
per property, a toggle when it is boolean, `--set <value>` for an explicit value.

## Exclusive arm and solo (user, 2026-10-12)

`arm` and `solo` do not follow Live's "Exclusive" settings: a write through the API changes only
the named tracks. Accepted as the behaviour — naming tracks is an explicit choice, like
Cmd-clicking the buttons — and to be stated in the command reference.

## `requires` as built (2026-10-11, `25b467a`)

- The check runs in `runLine` right after parsing and `--help`, before paths are resolved and
  before any pick list: `<cmd> --help` and usage errors work without the Remote Script, and
  nobody is asked to pick for a command that cannot run.
- Unavailable → the bridge's own code 5 and text (not installed / outdated / not running); the
  handler is not called and nothing is remembered.
- Deliberate: with the script missing, `goto <typo>` answers "not running" (5) rather than
  "not found" (3) — the first thing to fix is the script.
- `requires` is allowed on commands only, not on groups; an unknown requirement is a startup
  problem.
- Not built: marking unavailable commands when the palette opens. When it is, it uses the
  cached bridge state only, so opening never waits for a timeout. `--help` does not name the
  requirement yet.

## Documentation fields on the node (2026-10-12, `845b971`)

Three optional fields, confirmed by the user: `description` on a command or group (a sentence
or two beyond `summary`), `examples: { line, note? }[]` on a command, and `summary` on an
argument. They are the single source for `<cmd> --help` and for the generated command
reference (`npm run docs:reference`, checked in CI). Every runnable command has at least one
example, and every example line must parse — both are tests. Write them for a user of Live.

## `pickState` on the node (2026-10-13)

A runnable command may declare `pickState: { label, read(nodes, invocation),
change?(invocation) }`. When the platform is about to open a pick list for that command, it
calls `read` with the candidates and shows the returned state (true / false / null) per row
under `label` ("muted") as a state button. `change` (2026-10-19, `0462eba`) returns what
confirming does — "toggle" | "on" | "off" — and is copied into `SelectRequest.state.change`, so
the page can preview the result; a failure means absent. `read` is never called on the direct
path, is capped at 600 ms, and any failure means "no buttons". `mute`, `solo` and `arm` declare
both (`250fdd5`: no `--set` → "toggle", `--set 1` → "on", `--set 0` → "off"). Details: 0007 §4.

## `confirm` on `ModuleApi` (2026-10-19)

`api.confirm(message, confirmLabel): Promise<boolean>` asks a yes/no question before a
destructive command (first user: `history clear`). The platform shows it as a single-select
pick list with two rows ("Cancel" first, then `confirmLabel`, so a reflex `Enter` does
nothing; `f113c9a`) through `Ui.select` and the dialog queue; `Esc` or Cancel → false. A command offers `-f, --force` to skip it.

## Forgiving target resolution (2026-10-12; `461c885`, `46f241a`, `8588a8d`)

How the platform reads the text of a `path` argument (`src/core/resolveArgs.ts`):

- A comma always separates targets; a word starting with `/` and a quoted word are targets of
  their own. Remembered lines consist of those, so they resolve exactly as before.
- The remaining bare words are tried as one pattern: an exact path first, else text matching
  within the argument's `kinds`: every word occurs in the object's path **and at least one
  word occurs in the object's own name** (the "own name" rule, user 2026-10-13, `60a1dc2`).
  `mute e-piano` names the track E-Piano, not the devices and chains below it;
  `mute vermona kick` names the Kick pad. A single text target follows the same rule.
- `find` is a search and keeps the looser rule on purpose (user, 2026-10-13): it lists
  everything whose path contains the words. Two rules, stated in the docs.
- **One list also with misses (decided 2026-10-19, after `arm vermona sh` opened two lists):**
  when some texts are ambiguous and others match nothing, their "did you mean" suggestions join
  the same pick list, each row tagged with its word and suggestion rows marked as such. Safe
  because a multi-select list has no preselection — only marked rows run. Built `21aa5d7`: suggestion rows
  are tagged `"word"?`; `Esc` → "nothing matches" (exit 3); a missing word nothing fits fails
  at once, before any list. Rejected: widening
  `arm` to chains just to share the list (it would offer rows it can never arm).
- **Per-word tags kept (user, 2026-10-19):** when each word is its own target, the shared pick
  list tags every row with its word; the user likes it as a first step towards fuzzy finding
  (0006, "Target picture"). Matching joined words without spaces (`drum 2` → `Drum2` at once)
  was proposed and rejected, because it would skip this list.
- **Joined words win when they hit** (user, 2026-10-13, after trying the stricter rule in
  Live; replaces "never choose between two readings"): one joined hit → resolved without a
  question; several joined hits → one pick list with exactly those. The single words are not
  offered as an alternative. Accepted consequence: with a group "Drums" holding a track "Kick",
  `mute drums kick` means Kick; both are `mute drums, kick`.
- No joined hit → each word is its own target, as before.
- One pick list per command: all ambiguous texts of an argument share one multi-select list;
  the row's detail names the text it matched. A single-target argument keeps a single-select
  list and uses only the one-pattern rule.
- Nothing matches → "did you mean": a pick list with the closest names (fuzzy, at most 8, no
  suggestions for words under 3 characters). Never run unasked, even with one candidate; `Esc`
  gives the original "nothing matches" (exit 3, nothing remembered). If one of several missing
  texts has no plausible candidate, the command fails at once.
- Authoring rule: declare `kinds` unless a command really means every kind — without them
  most words resolve alone and multi-word input asks more often.

## Optional use of the bridge (2026-10-12, `7e4d787`)

A command that works without the Remote Script but gets better with it does not declare
`requires`. It asks the bridge only when the cached state allows it (one `available()` when
the state is unknown, nothing when it is "unavailable") and falls back to its SDK-only
behaviour otherwise. `arm` is the first: it reads `track_facts` to refuse tracks Live cannot
arm. The state check in `src/modules/armFacts.ts` becomes a bridge helper when a second
command needs it.

## Import boundaries (2026-10-11, enforced by `src/architecture.test.ts`)

- A module does not import another module's folder, `src/extension`, `src/httpTrigger` or a
  platform dialog page (`interface`, `pick`, `feedback`). It may import its own page
  `ui/<module>-*.html`. Only `src/modules/index.ts`, the manifest, imports module folders.
- `src/core/` does not import modules, `httpTrigger` or `extension`.
- `src/ableton/` does not import modules, `core/ui` or `extension`.
- Only `src/core/ui.ts` calls `showModalDialog`.
- One known exception, listed in the test: `pakabl list` opens its own dialog until the `page`
  surface exists.

## Verification

- Registration rejects each rule violation above with a clear startup error.
- `mute -d /a /b`, `pakabl install <id>`, `cmdabl setup` parse to the expected `Invocation`;
  `--help` on a group and on a leaf prints usage; missing/unknown arguments produce a failing
  `CommandResult` with usage.
- Old spellings still work through the adapter or aliases until removed.
