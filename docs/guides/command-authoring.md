# Writing a command

A command is one declaration. The platform parses the line, resolves paths to Live objects, asks when a name is
ambiguous and generates `--help`. Design background:
[0005](https://github.com/MarvinHauke/cmdAbl/blob/main/docs/feature-plans/0005-command-tree-and-module-authoring.md).
How the layers fit together is on the [Architecture](../architecture.md) page.

## A module with one command

A module is a folder under `src/modules/<name>/` with an `index.ts` that exports `activate(api)`. Add it to `MODULES`
in `src/modules/index.ts`; nothing else in the platform changes.

```ts
import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ok } from "../../core/types.js";

export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "flip",
    summary: "toggle mute on tracks",
    description: "Switches mute on for each track that is not muted and off for each that is.",
    examples: [{ line: "flip /Kick, /Snare", note: "two tracks, separated by a comma" }],
    args: [{ name: "track", kind: "path", kinds: ["track"], variadic: true, summary: "Tracks to flip" }],
    run: (invocation) => {
      const nodes = (invocation.args[0] ?? []) as ObjectNode[];
      api.tracks.transaction(() => {
        for (const node of nodes) {
          const track = api.tracks.track(node);
          if (track) track.mute = !track.mute;
        }
      });
      return ok();
    },
  });
}
```

`run` gets the parsed invocation. `invocation.args[0]` holds the Live objects of the first argument, each already
resolved to exactly one object. A successful write returns `ok()` with no message, and the palette stays silent.

## Rules

- A command does one thing. Words are commands and subcommands; `--flags` are options; an action is never a flag.
- The handler never parses raw input, never resolves paths, never reaches the SDK or the socket directly and never
  shows a dialog for an error. It returns a `CommandResult`: `ok()`, or `fail(ExitCode.…, message, details)`.
- Nothing throws at a user action. An uncaught error stops the whole Extension Host. The platform turns a throw
  from a handler into exit code 1, but catch what you can and return a result.
- Write several targets in one `api.tracks.transaction`. Its callback must be synchronous: `await` before it, not
  inside.
- Prefer setting over toggling where a re-run from history should mean the same thing (`mute --set 1`).
- Declare `kinds` on `path` arguments unless the command really means every kind.

## Options and arguments

An `ArgDef` has a `kind` (`path`, `enum`, `text` or `number`), and `required`, `variadic` (takes all remaining
tokens), `rest` (takes the rest of the line as one value) and `kinds` (which objects a `path` matches).
An `OptionDef` has a `name`, a `short` form and a `summary`. For an option with a value:

| Field | What it does |
|---|---|
| `takesValue` | The option takes a value: `--set 1` or `--set=1`. |
| `choices` | The allowed values. The parser rejects anything else with a usage error that lists them. |
| `number` | `{ min, max, integer }`: the value must be a number in that range. The handler gets the text. |
| `values` + `valueLabels` | The option takes N values, as in `--rename <old> <new>`. The handler reads them from `invocation.values[name]`; `invocation.options[name]` is `true`. |
| `valueDefault` | The value when the option is given without one: `tag -e` acts like `tag -e #`. |

`--help` and `--pick` are reserved option names, and `-h` is the reserved short form.

Two more fields on a command help it behave like the others:

- `requires: ["bridge"]` says the command cannot work without the Remote Script. The platform checks it before it
  resolves anything or asks the user to pick, and answers exit code 5 when the script is missing.
- `pickState` makes the pick list show a state button on each row: `read(nodes, invocation)` gives the state per
  row, and `change(invocation)` says what `Enter` would do (`"toggle"`, `"on"` or `"off"`).

## What a command shows

A result goes to one of three places:

- **A dialog** for a failure and for output the user asked for. `fail(…)` shows its message; `ok("text")` shows the
  text.
- **Silence** for a successful write: `ok()` with no message.
- **The log** for everything else. `CommandResult.log` holds lines that the platform writes to the log at info under
  the command's name. The presenter never shows them. A successful write that has something to report returns only
  `log`. Put what changed there, and the commands that undo it if Cmd+Z cannot.

A write that changes nothing should say so with a message ("/Bass already has #bass"), because a silent result
would look like success. A failure that touches several targets returns one `details` entry per target.

## Reaching Live: the ports

A module never touches the SDK or the socket. It uses the ports on `api`, so a command's `run` can be tested with
fakes (`createFakeApi` in `src/modules/testPorts.ts`, which fakes `set.id` and `files` too).

| Port | Use it for |
|---|---|
| `api.bridge` | Calls to the Remote Script (`select`, `trackFacts`, `chainSet`, …) through the typed functions in `src/ableton/bridgeOps.ts`. It never throws; a failure is a result with the bridge's exit code and text, which you pass on unchanged. |
| `api.liveSet.nodes()` | The Set's objects (tracks, devices, chains and pads), flattened, for find-like commands and the palette rows. |
| `api.tracks` | `transaction(fn)` (one undo step; `fn` is synchronous, but it may return a promise to group async writes into the step), `track(node)` → `{ mute, solo, arm }` or null, `volume(node)` → `Promise<number \| null>` and `setVolume(node, v)` → `Promise<boolean>`. `volume` is 0..1, where 0.85 is 0 dB, for regular, return, group and main tracks; null when the node is no track or the read fails. `setVolume` clamps to 0..1 and resolves false for no track or a failed write. The dB ↔ value conversion (Live's measured curve) is in `src/modules/mixValue.ts`. SDK-backed, so it works without the Remote Script. |
| `api.set.id(create?)` | `Promise<string \| null>`: the Set's own id, kept in the Set. With `create` it is made if missing. Null when the Set has no id yet (without `create`) or the id could not be read (no or old Remote Script, no token, timeout), so never treat null as "no id". The op needs the bridge token, also for a read. |
| `api.files.read(name)` and `api.files.write(name, text)` | `Promise<string \| null>` and `Promise<boolean>`: text files in a folder of your module in cmdAbl's data folder. Names are plain: no `/`, `\` or `..`, no leading dot, at most 100 characters. UTF-8, written atomically, at most 1 MB per write. A missing or unreadable file reads null. Nothing throws. |
| `api.tags` | Track tags: `refresh()` reads them from the script, `of(node)` returns a track's tags, `write(node, tags)` replaces them. Names must be normalised by the caller. |
| `api.pick(title, candidates, multi?, options?)` | The pick list, when a command has to ask. `options.state` gives each row a state button: `{ label, values, change? }` with `values[i]` true, false or null. |
| `api.pickTags(title, rows, options?)` | A list of tags. `rows` are `{ name, count?, on? }`. `options.multi: false` makes it single-select, `options.allowNew` adds a row that creates a new name, `options.change` previews what `Enter` does. It resolves with the chosen names, or null. |
| `api.ui.board(request)` | The tag board: sections whose items are on or off. It resolves with the changes; the page applies nothing, so the module writes them. |
| `api.confirm(message, confirmLabel)` | A yes/no question. `Cancel` is the first row, so a reflex `Enter` never acts. |
| `api.dialog(html, width, height, name?)` | A page of the module's own, through the dialog queue; resolves with the string the page returns, or null when dismissed. |
| `api.log(line)` | One log line at info: `cmdAbl [<module>] info: …`. The platform adds the prefix; write the text only. |
| `api.logger.{debug,info,warn,error}(text)` | The same, at the level you name. `debug` lines show only after `cmdabl log --debug`. |
| `api.commands` | `add`, plus `roots()`, `help(path)` and `usage(path)` for commands such as `man`. |
| `api.registerProvider`, `api.onPick`, `api.onCommandRun`, `api.showFeedback` | Palette rows, a listener for picks, a listener for finished commands, and a small message. |

A module that has its own page puts the HTML in `ui/modules/<module>/`. A module may import a page only from its own
folder.

## Completing arguments

`#tag` targets and Live paths are built in, so a target needs no completer. For other values, such as an extension id or a tag name, give the argument or
option a completer:

1. In `activate`, register a source: `api.commands.completer(key, source)`.
2. Name the key in `ArgDef.complete` or `OptionDef.complete`.

An option with `complete` must take a value, and cannot also have `choices` or `number`. For an enum whose values
change at run time, use `kind: "enum"` without `choices`, and name the completer in `complete`.

`source(ctx)` returns a list of `string | { label, insert?, description? }`, directly or as a promise. `insert` is the
raw value; the platform quotes it when needed.

- The platform calls `source` once each time the palette opens, with no tokens. It filters the rows while the user
  types and shows at most about 100 rows per position.
- A source is read-only: no writes, no dialogs, no bridge calls. Read from caches (the platform refreshes tags and
  chains when the palette opens).
- Stay within about 100 ms. If `source` throws or times out, the user sees no rows and a debug log line is written.
  Work that is not async cannot be interrupted, so keep it cheap.
- A key that is not registered gives a warning at activation. Module tests assert that `fake.unknownCompleters()` is
  empty.

## Logging

Never call `console.` in a module; the architecture test fails on it. Log through `api.log` or `api.logger`. Never
put a token, a secret or an environment value in a log line.

## Test it

Build the fake with `createFakeApi({ nodes, bridge })`, activate the module on `fake.api`, and call the declared
command's `run` with an invocation. Add a `docs.test.ts` that runs `assertDocumented`, so every example line must
parse:

```ts
import { test } from "node:test";
import { assertDocumented, declaredBy } from "../docs.testkit.js";
import { activate } from "./index.js";

test("flip: the command is documented and its examples parse", () => {
  assertDocumented(declaredBy((api) => activate(api)), ["flip"]);
});
```

## Documentation fields

These texts are the single source for `<command> --help`, for `man <command>` and for the generated command reference
(`npm run docs:reference`). Write them for someone using Live, not for a developer.

| Field | On | What goes in |
|---|---|---|
| `summary` | command, option | One line: what it does. |
| `description` | command, group | A sentence or two beyond the summary: what it needs (the Remote Script, macOS), what it changes, what it refuses. Plain text; no markdown backticks, they show literally in `--help`. |
| `examples` | runnable command | At least one `{ line, note? }`: the line exactly as typed, and a few words of note. Add one per form that differs (several targets, a quoted path, a flag). |
| `summary` | each argument | What to type there. |
| `topic` | top-level command | The heading `help` and the command reference list it under: "Find and select", "Mix", "Tags", "Look things up", "Recent commands" or "Extensions" (core sets the topic of `help` and `cmdabl`). The topics appear in that fixed order, and the commands of a topic in the order their modules are listed in `src/modules/index.ts`. A missing or unknown topic puts the command under "More commands". |
