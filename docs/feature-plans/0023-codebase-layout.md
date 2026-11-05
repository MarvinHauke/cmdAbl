# Codebase layout

**Status:** Draft (2026-11-05) — study by cmdabl-core, step 1 of the layout work (user, 2026-11-05: "a structured and
organized codebase"). Nothing is moved yet. Step 2 is the decision with the user, step 3 the mechanical move.

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0021](0021-installation-and-setup-page.md) (the setup files exist now)

## Context

`src/core/` has 52 source files in one folder (about 9,000 lines, 44 test files beside them). The rule is that the core is
minimal: only what must always be present. Today it also holds features that grew there: MIDI, the volume curve, the
setup page, track-volume and set-watch adapters. `src/modules/` has 14 modules plus 13 shared source files directly in the
folder (`mixValue.ts`, `trackSet*.ts`, `testPorts.ts`, …).

Two questions, answered below: (1) which core areas could be a module with today's `ModuleApi`, and what would each need;
(2) how to group what stays, so the folders say what the code is for.

The import graph (read from the `import` lines; `core/types.ts`, `log.ts` and `tokenize.ts` are leaves everyone uses):

- the **command language** — `tokenize`, `parse`, `commandTree`, `commandRegistry`, `resolveArgs`, `run`, `tags`, `topics`,
  `referenceDoc`, `defaultCommands`, `objectRow`, `commandProvider`, `configAttach`;
- **completion** — `complete`, `completeSnapshot`, `match`;
- **UI contract** — `ui`, `board`, `pick`, `confirm`, `dialogQueue`, `livePage`, `inlineJson`, `present`, `pickResult`,
  `notifySize`, `paletteSize`, `pickSize`, `helpLine`, `settingsSurface`, `defaultsSurface`;
- **settings** — `settings`, `files`;
- **MIDI** — `midi`, `midiEngine`, `midiPort`;
- **setup** — `setup`, `setupRows`, `setupFacts`, `setupFlow`, `setupAdvice`, `openUrl`, `childEnv`, `samePath`;
- **host adapters** — `volume`, `setWatch`, `headless`, `bridgeStatus`, `curve`;
- **builtins** — `help`, `cmdabl setup|config|log|curve|bridge`.

`extension.ts` (680 lines) wires all of it and is the only file that sees the SDK.

## Study: what could be a module with today's `ModuleApi`

`ModuleApi` offers: `bridge`, `liveSet`, `tracks`, `set`, `files`, `settings.declare/get`, `midi`, `log/logger`, `dialog`,
`commands.add/roots/help/usage/completer/defaults`, `pick`, `ui.board/livePage`, `confirm`, `pickTags`, `tags`,
`onPick`, `registerProvider`, `onCommandRun`, `showFeedback`. Rule 6 keeps modules off `child_process`, `fs` and `net`.

| Area | As a module today? | What it would need |
|---|---|---|
| **`cmdabl curve`** (`curve.ts`, 75 lines) | **Yes.** It needs `bridge` (param_display through `bridgeOps`, which rule 5 allows) and `liveSet.nodes()` for the first track. | Nothing in `ModuleApi`. Its command is a child of the `cmdabl` group; as a module it is a top-level `curve` (a rename the user decides). |
| **`cmdabl bridge`** (`bridgeStatus.ts`, 95) | **Yes**, same way: `bridge.ping()`. The `GET /bridge` diagnostic route stays in `httpTrigger`. | Nothing; the route needs the same function, so it stays in the core, or the module exports it. |
| **MIDI** (`midi`, `midiEngine`, `midiPort`, 580 lines) | **Partly.** Types and the port are already used by the `map` and `midi` modules through `api.midi`. The engine runs binding lines headless, filters on `map.enabled`, and holds the port to the Live-side listener route. | `api.run(line)` (a headless run), `api.routes.add(path, handler)` (the listen route the Remote Script posts to), access to the HTTP server. Today these are the platform's plumbing in `extension.ts`; making the engine a module means exposing them. **Recommendation: keep as a platform service**, in its own folder; the `map` module is already the feature. |
| **Volume / set-watch adapters** (`volume.ts`, `setWatch.ts`) | **No — they are not features.** They adapt the SDK to `TracksPort` / `SetPort`. | They belong to the host layer, next to `extension.ts` (they hold the only SDK knowledge outside it). |
| **Setup page** (`setup*`, `openUrl`, `childEnv`, `samePath`) | **Not today, and probably not at all.** It must work on a fresh install before any module is trusted; it gives the page its first-use opening. | `ui.notifyAnswer` (a page with a waited answer), `headless()`, `run(line)`, `openUrl`, a first-use/palette-open hook, a route registration for `/karabiner/cmdabl.json`, and a shell (rule 6: an exception list entry like pakabl's). That is five additions for one consumer. **Recommendation: keep in the core as its own folder.** Reconsider if a second module needs a waited notify page. |
| **Settings, defaults, config** | **No.** They are the store and the pages every module's settings depend on. | — |
| **Tags target** (`core/tags.ts`) | **No.** `#fx` targets are parsed and fanned out by the resolver (`resolveArgs`); the `tag` module is the feature on top. | — |
| **Completion engine** | **No.** It is the palette's snapshot (also bundled into the page). | — |
| **`help`** (builtin) | **Yes** in principle (the `man` module already exists beside it): it only needs `commands.roots()`. | Nothing; it lists by topic with `commandListText`. Moving it into `man` is a small, separate cleanup. |

So with no `ModuleApi` change two small commands (`curve`, `bridge`) and `help` could become modules; MIDI and setup
could become modules only through additions that would exist for a single consumer. That is the decision for the user
(step 2): **no `ModuleApi` change now** is the recommended answer, and only `curve` and `help` move into modules.

## Proposed layout

Folders under `src/core/` by what the code is for (the `ui/` word is taken by the dialog pages at the repository root, so
the contract folder is `surfaces/`):

| Folder | Files |
|---|---|
| `command/` | `tokenize`, `parse`, `commandTree`, `commandRegistry`, `commandProvider`, `resolveArgs`, `run`, `tags`, `topics`, `referenceDoc`, `defaultCommands`, `objectRow`, `configAttach`, `builtins` |
| `complete/` | `complete`, `completeSnapshot`, `match` |
| `surfaces/` | `ui`, `board`, `pick`, `pickResult`, `pickSize`, `paletteSize`, `notifySize`, `confirm`, `present`, `dialogQueue`, `livePage`, `inlineJson`, `helpLine`, `settingsSurface`, `defaultsSurface` |
| `settings/` | `settings`, `files` |
| `midi/` | `midi`, `midiEngine`, `midiPort` |
| `setup/` | `setup`, `setupRows`, `setupFacts`, `setupFlow`, `setupAdvice`, `openUrl`, `childEnv`, `samePath` |
| `host/` | `headless`, `volume`, `setWatch`, `bridgeStatus` |
| stays | `types.ts`, `log.ts` (leaves, used by `ableton/` too, rule 3) |

Tests move with their files. `src/modules/`: the shared files go to `modules/shared/` (`mixValue`, `trackSet*`,
`armFacts`, `selectNode`, `chainSwitch`, `midiCapture`, `mixTable`, `relative`, `testPorts`, `docs.testkit`), and
`modules/types.ts` and `portMapping.ts` stay where they are named in the agent files and the architecture test.

Cycles to resolve while moving: `ui.ts` imports `board`, `settingsSurface`, `defaultsSurface`, `livePage` and those
import `ui` for their types (types only, so no runtime cycle); `commandRegistry` ↔ `complete` through `commandTree`.
Both are type-level and stay legal as long as each folder's index is not a barrel (no barrel files).

## Cost of the move

- About 52 files and 44 tests change their import specifiers; modules import 25 core files by path
  (`../../core/x.js`), so the modules' import lines change too. `modules/types.ts` re-exports many of them and is the
  one file whose edits need announcing to `cmdabl-modules` and `cmdabl-bridge`.
- `src/architecture.test.ts` rules 2–5 are written with `src/core/` prefixes. They keep their meaning if the folder
  prefix check becomes "under `src/core/`", but the exception lists and the `core/types` / `core/log` allowance for
  `ableton/` need the new paths in the same commit.
- Docs that name core paths (`CLAUDE.md`, the agent files, plans 0004–0021, `docs/guides/`) are updated in the same
  commit; this is the largest part by line count. `scripts/` (the reference generator) imports `referenceDoc` and the
  tree.
- No behaviour changes: the move is `git mv` plus import rewrites, checked by `npm test`, `npm run build` and the
  bundle test.

## Open questions

- **`cmdabl curve` / `cmdabl bridge` as modules:** they would become top-level commands (`curve`, `bridge`) or the
  `cmdabl` group is declared by the builtins and modules add children to it — which the registry does not allow today.
  Decide the names with the user.
- Whether `host/` is a good name for the SDK adapters, or whether they go next to `extension.ts` in `src/host/`.
- Whether `builtins.ts` should be split by command once `curve` and `help` leave it (it would be `cmdabl setup|config|log`).
- `src/ableton/` is already one folder with a clear job; its files keep their place.

## Phased rollout

1. This study (done), reviewed by cmdabl-architect.
2. Decision with the user: which of the above move into modules, and the folder names.
3. The mechanical move in one commit (core + modules shared + architecture test + docs), nothing else in it.
4. The small module moves (`curve`, `help`) as separate commits after.

## Verification

- `npm test` and `npm run build` pass before and after; the production bundle test (`tools/`) is the check that nothing
  imports a Node built-in into the palette page.
- `git diff -M --stat` for the move commit shows renames only plus import-line changes.
- The architecture test lists no new exception.
- A Live smoke run through the MCP tools: `cmdabl setup` (headless lines), `map -l`, `mute`, `cmdabl config`.
