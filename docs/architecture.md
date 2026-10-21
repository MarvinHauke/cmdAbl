# Architecture

This page is for someone who wants to understand cmdAbl or extend it. You know TypeScript. You do
not need to know this code yet. Read the first two sections for the big picture, then the section
about the layer you plan to touch.

## What cmdAbl is

cmdAbl is a command palette for Ableton Live. You type a short line such as `mute /Bass` and cmdAbl
runs it on the open Live Set. It is built on the Ableton Extensions SDK. The SDK lets a TypeScript
extension run inside Live's Extension Host, a background process that Live starts with the
extension. Most of cmdAbl is TypeScript in that host.

The SDK cannot do everything cmdAbl needs. For example, it cannot change the track selection. For
those jobs cmdAbl uses a small companion Remote Script written in Python. Live runs the Remote Script
inside its own Python. The two talk over a local UDP socket on `127.0.0.1`.

```
 Live
 +-- Extension Host (TypeScript, the SDK)
 |     dialogs  <--->  core: parse, check, resolve, run, present
 |                       ^                  |
 |                       |                  v
 |                   modules          ableton: object tree, bridge client
 |                  (commands)                       |
 +--------------------------------------------------|----------------+
                                                    | UDP 127.0.0.1:27185
                                                    v
                                    Remote Script (Python, in Live)
```

The palette is a dialog, not a window of cmdAbl's own. The Extension Host opens it with the SDK. A
Karabiner rule on macOS can open it too, by sending a request to a small local server in the host.

## The command contract

cmdAbl's commands follow the model of POSIX and GNU command-line tools such as `git` and `docker`:

```
cmdabl setup                       a command, then a subcommand
find -c snare                      a command, an option, then a text argument
mute /Bass, /Lead                  a command, then several path arguments
```

- Bare words name a command or a subcommand.
- `-x` and `--long` are options. They change how a command runs.
- `--help` prints the short usage of any node. `man <command>` prints the full page.

A module declares a command. It gives the command a name, options, arguments, a one-line `summary`,
a longer `description`, and `examples` that must parse. The platform does the rest:

1. It parses the typed line against the declared tree. A line that does not fit gets exit code 2
   (usage), with the usage text, and the handler never runs.
2. For each `path` argument it finds the Live objects the text means. Zero matches is exit code 3
   (not found). More than one is a question to the user: a pick list (see below). The handler only
   ever receives objects that were resolved uniquely.
3. It calls the handler with a parsed invocation: the options and the resolved objects.
4. The handler returns a result: a message, an exit code and, for several targets, one entry per
   target. The exit codes are:

| Code | Meaning |
| ---- | ------- |
| 0 | ok |
| 1 | failure: the command ran and did not succeed, possibly for some targets |
| 2 | usage: missing or unknown arguments or options |
| 3 | not found: a command or an addressed object does not exist |
| 4 | ambiguous: an address matches more than one object |
| 5 | unavailable: a companion is missing, such as the Remote Script |

Two rules hold across the platform:

- **Nothing throws at a user action.** An uncaught error stops the whole Extension Host, including
  other extensions. So the platform catches every error a handler raises and turns it into a
  result with exit code 1.
- **One presenter renders every result.** Messages, error text and per-target details all go through
  one function. A module returns a result and does not show anything itself.

**Modules never parse and never guess.** A module does not read the typed text, does not decide
which of several objects a name means, and does not show a pick list on its own. It declares what
it accepts, and the platform does the rest.

## The layers and what each may import

The source is in five places. The rules below are enforced by `src/architecture.test.ts`, which
reads the import statements of every file under `src/` and fails when a rule is broken.

| Layer | What it is | What it may not import |
| ----- | ---------- | ---------------------- |
| `src/core/` | The platform: tokenizer, parser, command tree, resolver, pick flow, the UI contract, the result presenter. Minimal on purpose. | `src/modules/`, `src/httpTrigger.ts`, `src/extension.ts` |
| `src/modules/` | One folder per feature, listed in `src/modules/index.ts`. Each module declares commands and reaches Live through ports. | another module's folder, `src/extension.ts`, `src/httpTrigger.ts`, the platform's dialog pages, `src/ableton/bridge.ts`, `src/ableton/trackLookup.ts`, the SDK (`@ableton-extensions/*`) |
| `src/ableton/` | The Live Set as an object tree, path resolution, and the bridge client that talks to the Remote Script. | `src/modules/`, `src/core/ui.ts`, `src/extension.ts` |
| `remote-script/cmdAbl/` | The Remote Script, in Python. It runs inside Live and talks to the extension only over the UDP socket. | (Python; the rules above do not apply) |
| `ui/` | The dialog pages. The core pages are the palette, the pick list, the message page and the tag board. A module's own pages live in `ui/modules/<module>/`. They are HTML, CSS and JavaScript, inlined into the bundle at build time. | (HTML; no imports) |

The test states five rules:

1. A module does not import another module's folder, `src/extension.ts`, `src/httpTrigger.ts`, or
   the platform's pages `interface`, `pick`, `feedback` and `board`. A module may import its own dialog
   page only from its own folder, `ui/modules/<its own name>/`. Helpers placed directly under
   `src/modules/` are shared and follow the same rules. Only `src/modules/index.ts`, the manifest, may import every module folder.
2. `src/core/` does not import `src/modules/`, `src/httpTrigger.ts` or `src/extension.ts`.
3. `src/ableton/` does not import `src/modules/`, `src/core/ui.ts` or `src/extension.ts`. It knows the platform
   only through its shared types and the logger (`src/core/log.ts`).
4. Only `src/core/ui.ts` opens a dialog with `showModalDialog`. A module hands its page to the UI
   surfaces instead. The list of exceptions is empty.
5. A module reaches Live through the ports on `ModuleApi`. It does not import `src/ableton/bridge.ts`,
   `src/ableton/trackLookup.ts` or the SDK (`@ableton-extensions/*`). So a command's `run` can be
   tested with fake ports.

A known violation can be listed with a reason. An entry that no longer applies fails the test, so
the list cannot grow stale.

**How modules reach Live.** Modules reach Live only through ports on `ModuleApi`. The SDK's context
is no longer part of `ModuleApi`. The ports are:

- `bridge`: the typed client of the Remote Script. Its operations are the functions in
  `src/ableton/bridgeOps.ts`.
- `liveSet.nodes()`: the flattened object tree of the current Set.
- `tracks`: `transaction(fn)` groups changes into one undo step, and `track(node)` gives a track's
  SDK object. It works without the Remote Script. `track` returns nothing for a node that is not a
  track.
- `log(line)`: writes one line to the extension's log.
- `dialog(html, width, height, name?)`: opens a page through the dialog queue. It returns the
  string the page sends back, or nothing when the dialog was dismissed.

Modules keep `commands.add`, `pick`, `onPick`, `registerProvider`, `onCommandRun` and
`showFeedback`. The mapping of each port and script operation to the Live Object Model is in the
[Live API mapping](reference/live-api.md). Tests give a module fake ports with `createFakeApi` (`src/modules/testPorts.ts`), so
no test needs Live.

## The path of one command

Take `mute 808 snare` as an example. Here is what happens, step by step.

1. **Trigger.** You press `:` with Live focused, or you choose `: cmdAbl` from a clip, track, clip
   slot or scene's context menu. Both start the same extension command, `cmdabl.open`. The `:`
   path reaches it through the Karabiner rule, which posts to the local trigger server.
2. **Palette.** The extension collects the items every provider offers: the commands, the
   history, and the objects of the Live Set. It opens the palette dialog with them. The dialog
   returns one string when it closes: the line you typed, or the item you picked.
3. **Parse.** `src/core/parse.ts` walks the command tree by the bare words. `mute` is found;
   `808` and `snare` are its arguments. A usage error ends here with exit code 2.
4. **`requires` check.** A command may declare `requires: ["bridge"]`. The platform then asks the
   bridge whether the Remote Script is ready. If it is not, the command answers exit code 5 and the
   handler is not called. The check runs before any pick, so nobody is asked to choose for a command
   that cannot run. `mute` does not declare it, because it works without the Remote Script.
5. **Target resolution.** `src/core/resolveArgs.ts` reads the path words. The rule is forgiving but
   never silent:
   - A comma separates targets, and a word that starts with `/` is a whole path.
   - A full path is a target of its own, and `#2` picks the second of two same-named siblings. Otherwise
     the typed words must all occur in the object's path, and at least one of them in the object's
     own name. So `mute lead` names the track Lead, and `mute 808 snare` names the Snare Drum pad
     of the 808 kit. `find` is the one command that only needs the words in the path.
   - Words typed together win when they match: one object runs without a question, several objects
     give one pick list with exactly those. Only when they match nothing together is each word its
     own target; words that then match several share one pick list.
   - If nothing matches, the platform offers "did you mean": a pick list of the closest names. It
     never runs one of them without asking. `Esc` gives the original "nothing matches" answer.
6. **Pick, if needed.** The pick list is a dialog. It returns the chosen indexes. The platform
   replaces the text with the chosen objects and resolves again. All ambiguous texts of one
   argument share one list, so an argument costs at most one pick list.
7. **Handler.** The module's `run` receives the invocation with the resolved objects. It does the
   work and returns a result. If it throws, the platform catches the error and returns exit code 1.
8. **SDK or Remote Script.** A track's mute is set through the SDK. A chain or a Drum Rack pad is
   set through the Remote Script: the handler calls a typed operation of the bridge, which sends a
   request and reads the reply.
9. **Result.** The platform gives the result to the presenter, which shows it through the message
   surface. A successful result with no message shows nothing.
10. **History.** On exit code 0 the platform records the invocation in its resolved form, with
    every path written out in full. After you pick from the list, the chosen objects are what is
    remembered, each by its unique path. A re-run never asks again. Only lines with an argument are
    recorded. A module that keeps the history listens for these records; it does not read the
    palette itself.

## Dialogs

Every dialog is a modal dialog that the SDK opens with `showModalDialog`. Three rules apply:

- **JSON in, one string out.** The platform writes the request as JSON into the page when it opens.
  The page sends back exactly one string when it closes. A dialog cannot call the extension while
  it is open.
- **One dialog at a time.** The SDK does not handle a second modal while one is open. So every
  dialog goes through one queue in `src/core/dialogQueue.ts`. A dialog opens only after the one
  before it has closed. A dialog that fails to open counts as dismissed.
- **Four surfaces.** The platform talks to four surfaces, defined only by their data
  (`src/core/ui.ts`):
  - `prompt`: the palette. It takes the items and returns what was typed or picked, or nothing.
  - `select`: the pick list. It takes a title, the rows and an optional preview of the command line,
    and returns the indexes of the rows the user chose, or nothing when cancelled.
  - `notify`: a message. It takes a text and the exit code it belongs to, and returns nothing.
  - `page`: a dialog page of its own, given by name, HTML and size. It returns the string the page
    sends back, or nothing when it was dismissed. The `dialog` port of a module is built on it.

Because the surfaces are only data in and a value out, a page can be replaced without the core
noticing. The default pages are the files in `ui/`. The plan is in `0007-ui-surfaces` in the
feature plans.

## The Remote Script bridge

The SDK cannot select a track, and it cannot change a chain's mute or solo. The Remote Script does
both. It uses the Live Object Model (LOM), which only runs inside Live's Python.

- **Transport.** UDP on `127.0.0.1`, port `27185`. The extension binds one socket on a free port for
  its lifetime and sends from it, so replies come back to that socket. There are no files and no
  second port. The request waits at most 500 ms. A request that times out is not sent again by the client.
- **Messages.** A request is one JSON object: a protocol version `v`, an `id`, an operation name `op`
  and `args`. The reply carries the same `v` and `id`, and either a `result` or an `error` with a
  code and a text. Each error code maps to an exit code of the command: a changed Live Set,
  a missing or outdated script, and a bad request each have their own text.
- **`hello`.** The extension sends `hello` before it relies on the script, and caches the answer.
  It asks again after a failure. The script answers `hello` whatever version the request carries. The reply names the script version, the protocol version and the list of
  operations the script knows. `cmdabl bridge` sends one `hello` and shows the answer. The extension
  uses the same answer to tell the user whether the script is installed, outdated or not running.
- **Operations.** Each operation has one handler in the script's `ops/` folder and one typed function
  in `src/ableton/bridgeOps.ts`. Modules call the typed functions only. Reads and selection need no
  token. The operations are listed in the [Remote Script reference](reference/remote-script.md),
  which is generated from the code.
- **Access token.** An operation that changes something needs a token. The script creates a random
  token each time Live starts and writes it to a file in the extension's data folder under Application Support. The
  extension reads that file and sends the token with each writing request. A wrong or missing token
  is refused before any handler runs. The token protects against other local processes and stray
  datagrams. It does not protect against the user's own programs, which can change the Set anyway.
- **Timing.** The script reads its socket once per display tick in Live. Round trips measured in
  Live on 2026-10-12 had a median of about 50 to 60 ms and a maximum of about 100 ms. The script keeps
  answering while a dialog is open.

The script wraps every operation handler, so an exception in one does not reach Live. A request with
an `id` gets exactly one reply. An unreadable datagram is logged and dropped.

## Limits that shape the design

- **A dialog's size is fixed when it opens.** The SDK has no call to resize a dialog, so cmdAbl sizes each dialog
  from its content before opening it (`src/core/notifySize.ts`, `src/core/pickSize.ts`). A resize handle is a
  candidate for a feature request to Ableton.
- **Extensions cannot call each other.** `context.commands.executeCommand()` only reaches commands
  that the calling extension registered itself. cmdAbl cannot run another extension's command.
- **Only built-in Live devices can be inserted.** `insertDevice()` takes Live's own devices. A
  third-party plug-in cannot be loaded through the SDK at runtime.
- **Some reads and writes are outside the extension's bundle.** The installed extension runs in a sandbox
  that allows reads only in Live's Extensions and Extensions Data folders and the extension's temp folder. The
  installed-script check reads the Remote Script in the User Library, which lies outside those folders. The
  writing operations read the token file, which is inside them. Each such read fails soft: the command reports
  it, and nothing else breaks. The SDK reference in the repository (`docs/sdk-tree.md`, section 7) has the measured details.
- **Some web globals are missing.** When measured in Live 12.4.15b6, `URL`, `URLSearchParams`,
  `structuredClone`, `TextEncoder` and `crypto` were not present in the Extension Host. Import them
  from `node:url`, `node:util` or `node:crypto` instead. The full list is in
  [`docs/sdk-tree.md`](https://github.com/MarvinHauke/cmdAbl/blob/main/docs/sdk-tree.md), section 7.
- **Only one Extension Host connects at a time.** This is a constraint on development: tests in Live
  run one copy of the extension, not a user limit.
