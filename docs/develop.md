# Develop

This section is for people who want to change cmdAbl: fix a bug, add a command, or improve the documentation. You do
not need it to use cmdAbl.

## Get the Ableton Extensions SDK

cmdAbl is built on the Ableton Extensions SDK. Its license allows building and distributing extensions, but not
distributing the SDK itself, so the SDK is not in this repository. Get the SDK and CLI packages from Ableton's
Extensions beta and put them into the `vendor/` folder, with the file names that `package.json` names:

- `vendor/ableton-extensions-sdk-1.0.0-beta.1.tgz`
- `vendor/ableton-extensions-cli-1.0.0-beta.1.tgz`

You also need Node 24.16 or newer.

## Build, test and run

Run these from the repository root:

| Command | What it does |
|---|---|
| `npm install` | Installs the dependencies, including the SDK from `vendor/`. |
| `npm test` | Runs the unit tests. They need no Live. |
| `npm run build` | Type-checks and builds the production bundle. |
| `npm start` | Type-checks, builds and runs cmdAbl in Live's Extension Host. Turn on Developer Mode in Live first. Only one Extension Host connects at a time, so only one copy of cmdAbl runs. |
| `npm run package` | Builds the `.ablx` into the project root. |
| `npm run docs:reference` | Regenerates the reference pages (`reference/commands.md`, `reference/remote-script.md`, `reference/live-api.md`) from the code. Never edit those pages by hand. |

An installed build is sandboxed: it may read only Live's Extensions and Extensions Data folders and its temp folder.
A development run (`npm start`) is presumably not sandboxed (not verified), so a file access that works in development
can fail once installed. Test file access with the installed `.ablx`. A development run can see the User Library, so
it can say "Remote Script not installed" or "installed Remote Script is outdated" about the copy there. The installed
build cannot, and says "not running" instead.

The terminal of `npm start` shows the extension's log lines with milliseconds: `HH:MM:SS.mmm cmdAbl [<source>] …`.
Filter on `cmdAbl [` there. The log lines of the Remote Script are not in that terminal; they are in Live's `Log.txt`
(see [The Remote Script](remote-script.md)).

## Test the Remote Script

The Remote Script's protocol tests are Python, with the standard library only:

```sh
python3 -B -m unittest discover -s tests/remote-script
```

## Testing in Live with MCP

A development run (`npm start`) can run command lines without a dialog, so a coding agent can test commands in a
real Live Set. A packaged `.ablx` has none of this.

**Warning:** this changes the open Live Set. Use a test Set, and do not work in Live while a test runs.

**The two routes.** In a development run, cmdAbl offers two local routes on its trigger port, `127.0.0.1:27184`:

- `POST /run` with `{"line": "…"}` runs one command line without any dialog.
- `GET /log?n=` returns the last `n` log lines.

Both need a Bearer token (an access key sent in the `Authorization` header). cmdAbl writes it at each start to a
`run-token` file in its Extensions Data folder, readable by you only. Browser pages are refused. Never paste or print
the token.

**What a run does:**

- An ambiguous address ends with exit code 4 and lists the candidates.
- Questions, pick lists and pages are skipped, and the answer names them.
- Messages are captured and returned in the answer.
- One run is one undo step.
- A run is not added to the history.

**When it says no.** A run answers 409 (busy) while another run is going or a palette or dialog is open. A run that
takes longer than 10 seconds answers 504. `POST /reset` releases a run that is stuck.

**The MCP server.** MCP (Model Context Protocol) lets a coding agent call tools. The server is in `tools/mcp/`. The
project's `.mcp.json` registers it (`npx tsx tools/mcp/main.ts`); `npm run mcp` starts it by hand. Its tools:

| Tool | What it does |
|---|---|
| `cmdabl_run(line)` | Runs one command line, like `POST /run`. |
| `cmdabl_log(n)` | Returns the last `n` log lines. |
| `cmdabl_bridge()` | Says whether the Remote Script is connected and how fast it answers. |
| `cmdabl_state()` | Says whether a palette or dialog is open, so a run would be busy. |

When cmdAbl is not running, the tools say so within about 12 seconds.

**How to use it:**

1. Open a test Set in Live.
2. Start `npm start`.
3. Start Claude Code in the repository and allow the project's MCP server.
4. Run test lines with `cmdabl_run` and check the log lines with `cmdabl_log`.

What needs eyes or hands stays manual: how a dialog looks, Cmd+Z, moving a control.

## Build the docs site

The docs site is built with MkDocs:

```sh
pip install "mkdocs-material==9.*" "mkdocs<2"
mkdocs build --strict
```

`--strict` fails on a broken link. Run it before you commit a docs change.

## Pull requests

Use one branch per topic and open a pull request into `main`. These checks run on a pull request:

- `script-tests` runs the Remote Script's Python tests. It needs no SDK, so it also runs for pull requests from forks.
- `build` runs the unit tests, checks that the reference pages are up to date, and packages the `.ablx`. It needs the
  private SDK, which GitHub does not give to pull requests from forks. For a fork, `build` fails on purpose with a clear
  message, and a maintainer runs it from a branch in the main repository before merging.
- `docs-build` builds the docs site, when the pull request touches `docs/` or `mkdocs.yml`.
- `gitleaks` scans for secrets.

## How the code is organised

- [Architecture](architecture.md): the layers, the command contract and the Remote Script bridge.
- [Writing a command](guides/command-authoring.md): how to add a command or a module.
- [Remote Script protocol](reference/remote-script.md): the operations of the Remote Script. It is generated from the
  code.
- [Live API mapping](reference/live-api.md): how cmdAbl's paths map to the Live Object Model. It is generated from the
  code.

The project also uses a team of Claude agents with fixed areas. How they work is in
[`CLAUDE.md`](https://github.com/MarvinHauke/cmdAbl/blob/main/CLAUDE.md).
