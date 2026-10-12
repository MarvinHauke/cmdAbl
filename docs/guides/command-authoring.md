# Writing a command

A command is one declaration; the platform parses the line, resolves paths to Live objects and
generates `--help`. Design background: [0005](https://github.com/MarvinHauke/cmdAbl/blob/main/docs/feature-plans/0005-command-tree-and-module-authoring.md).

```ts
api.commands.add({
  name: "mute",
  summary: "toggle mute on tracks",
  description: "Switches mute on for each target that is not muted and off for each that is.",
  examples: [{ line: "mute /Kick, /Snare", note: "several targets, separated by a comma" }],
  args: [{ name: "track", kind: "path", kinds: ["track"], variadic: true, summary: "Tracks to mute" }],
  run: (invocation) => { /* … return ok() or fail(ExitCode.…, message, details) */ },
});
```

## Rules

- A command does one thing. Words are commands and subcommands; `--flags` are options; an action
  is never a flag.
- The handler never parses raw input, never resolves paths, never reaches the SDK or the socket directly and never shows a dialog for an error:
  it returns a `CommandResult` (`ok()`, `fail(ExitCode.…, message, details)`).
- Prefer setting over toggling where a re-run from history should mean the same thing; write
  several targets in one `withinTransaction` (its callback must be synchronous — await before it, not inside).
- Declare `kinds` on `path` arguments unless the command really means every kind.

## Reaching Live: the ports

A module never touches the SDK or the socket; it uses the ports on `api`, so a command's `run` can
be tested with fakes (`createFakeApi` in `src/modules/testPorts.ts`).

| Port | Use it for |
|---|---|
| `api.bridge` | Calls to the Remote Script (`select`, `trackFacts`, `chainSet`, …) through the typed functions in `src/ableton/bridgeOps.ts`. It never throws; a failure is a result with the bridge's exit code and text, which you pass on unchanged. Declare `requires: ["bridge"]` when the command cannot work without it. |
| `api.liveSet.nodes()` | The Set's objects (tracks, devices, chains and pads), flattened, for find-like commands and the palette rows. |
| `api.tracks` | `transaction(fn)` (one undo step; `fn` is synchronous and catches its own writes) and `track(node)` → `{ mute, solo, arm }` or null. SDK-backed, so it works without the Remote Script. |
| `api.log(line)` | One log line; write your own `cmdAbl: ` prefix. |
| `api.dialog(html, width, height, name)` | A page of the module's own, through the dialog queue; resolves with the string the page returns, or null when dismissed. |
| `api.pick(title, candidates, multi)` | The pick list, when a command has to ask. |

Test a command by building the fake with `createFakeApi({ nodes, bridge })`, activating the module
on `fake.api`, and calling the declared command's `run` with an invocation.

## Documentation fields

These texts are the single source for `<command> --help` and for the generated command reference
(`npm run docs:reference`). Write them for someone using Live, not for a developer.

| Field | On | What goes in |
|---|---|---|
| `summary` | command, option | One line: what it does. |
| `description` | command, group | A sentence or two beyond the summary: what it needs (the Remote Script, macOS), what it changes, what it refuses. Plain text — no markdown backticks, they show literally in `--help`. |
| `examples` | runnable command | At least one `{ line, note? }`: the line exactly as typed, a few words of note. Add one per form that differs (several targets, a quoted path, a flag). |
| `summary` | each argument | What to type there. |

Every example line is parsed by the test `assertDocumented` (`src/modules/docs.testkit.ts`); a
module's `docs.test.ts` calls it, so an example that does not parse fails `npm test`.
