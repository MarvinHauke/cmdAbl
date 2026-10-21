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

A development run (`npm start`) is not sandboxed, and an installed build is. The installed extension may read only
Live's Extensions and Extensions Data folders and its temp folder, so a file access that works in development can fail
once installed. In a development run, cmdAbl can also see the User Library, so it can say "Remote Script not
installed" or "installed Remote Script is outdated". The installed extension cannot, and says "not running" instead.
Install the `.ablx` and test it before you rely on a file access.

The terminal of `npm start` shows the extension's log lines with milliseconds: `HH:MM:SS.mmm cmdAbl [<source>] …`.
Filter on `cmdAbl [` there. The log lines of the Remote Script are not in that terminal; they are in Live's `Log.txt`
(see [The Remote Script](remote-script.md)).

## Test the Remote Script

The Remote Script's protocol tests are Python, with the standard library only:

```sh
python3 -B -m unittest discover -s tests/remote-script
```

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
