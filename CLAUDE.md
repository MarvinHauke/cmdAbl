# cmdAbl

A command palette for Ableton Live, built on the Ableton Extensions SDK (TypeScript, runs in
Live's Extension Host) with a small companion Remote Script (Python) for what the SDK cannot do.

## Where things are

- `src/core/` — the platform: tokenizer, parser, command tree, resolver, pick flow, UI contract,
  result presenter. Minimal on purpose: only what must always be present.
- `src/modules/` — everything else. One module per feature, listed in `src/modules/index.ts`.
- `src/ableton/` — the Live Set as an object tree, path resolution, the bridge client.
- `remote-script/cmdAbl/` — the Remote Script (selection and other LOM-only operations).
- `ui/` — the dialog pages (palette, pick list, messages), inlined into the bundle at build time.
- `docs/feature-plans/` — design plans; `0004` is the umbrella for the command platform.
  `docs/guides/` — how releasing, the pakabl index and CI work. `docs/sdk-tree.md` — SDK reference.

## Rules that hold everywhere

- Modules declare commands; the platform parses, resolves paths to Live objects and asks the user
  when an address is ambiguous. Modules never parse and never guess.
- A handler returns a `CommandResult` (exit code 0 ok, 1 failure, 2 usage, 3 not found,
  4 ambiguous, 5 unavailable). Nothing throws at a user action: an uncaught error takes down the
  whole Extension Host, including other extensions.
- A dialog gets JSON in and returns one string when it closes. Everything that changes Live happens
  through a command after it closes. **Exception: a live page** (user, 2026-11-04; plan 0018). It is
  served from `http://localhost:27184` with a one-time token per dialog, and may only **read** from
  cmdAbl while open, through routes that exist only for that dialog. It never writes, and it still
  works when the server can't be reached. Extensions cannot call each other.
- Keep plans, README and code in sync in the same change.

## Agent team

Peer Claude sessions that message each other (`SendMessage`), watchable in tmux:

| Name               | Agent file                    | Model  | Job                                                     |
| ------------------ | ----------------------------- | ------ | ------------------------------------------------------- |
| `cmdabl-architect` | `.claude/agents/architect.md` | opus   | lead; tasks, plans, contract decisions, Live test lists |
| `cmdabl-core`      | `.claude/agents/core.md`      | sonnet | the platform (`src/core/`, registry, module interface)  |
| `cmdabl-modules`   | `.claude/agents/modules.md`   | sonnet | commands as modules (`src/modules/`), authoring guide   |
| `cmdabl-bridge`    | `.claude/agents/bridge.md`    | sonnet | Live access (`src/ableton/`, `remote-script/`)          |
| `cmdabl-reviewer`  | `.claude/agents/reviewer.md`  | opus   | read-only review against the plans and SDK limits       |
| `cmdabl-ui`        | `.claude/agents/ui.md`        | sonnet | dialogs and themes (`ui/`) — **on demand**              |
| `cmdabl-docs`      | `.claude/agents/docs.md`      | sonnet | docs site, README, images (`docs/`) — **on demand**     |

Flow: architect → builder → reviewer (→ architect for contract decisions) → builder commits →
short overview with a Live test list to the architect → the architect runs it through MCP → the user
gets a short list of the core features to try by hand, plus what only they can check.

- **One agent per area.** Tasks name the files an agent owns; before editing, check
  `git diff <file>` and don't touch a file with another agent's uncommitted changes; stage only
  your own files (no `-A`, no interactive `-p`). `src/modules/types.ts` is edited by `cmdabl-core`
  only.
- **Only the user starts or restarts Live**, and only one Extension Host connects at a time.
  **The architect may start and restart `npm start`** once the user has said in this session that Live
  is free (user, 2026-11-03). It runs in a tmux pane next to the architect, in the architect's window,
  so the user can watch the log. Other agents never run `npm start`; they run `npm test` and
  `npm run build` and hand over a Live test list.
- **Testing in Live through MCP** (plan 0016): when the user has said in this session that a test
  Set is open and Live is free, an agent may run its test list with the `cmdabl_*` MCP tools
  (`cmdabl_run`, `cmdabl_log`, `cmdabl_bridge`, `cmdabl_state`). One agent at a time; the architect
  says whose turn it is. Report what passed with the log lines; hand the rest (how dialogs look,
  Cmd+Z, hand moves, anything that asks) to the user. Never run commands that delete or rename
  outside the test list.
- **A message to an agent that isn't running** (stopped, or the send fails): send it to
  `cmdabl-architect` instead, naming the intended agent. The architect starts that agent or handles it.
- **Only the architect pushes or opens pull requests, and only when the user asks.**
- `scripts/agents.sh` opens core, modules, bridge and reviewer in one tmux window `cmdabl-agents`
  and starts the architect in the current pane, each as a **fresh** session (model from its agent
  file; the agent file, this file and STATUS are the hand-over). `--resume` continues an agent's stored
  session instead: use it only for unfinished work, since a long session reloads its whole history.
  `scripts/agents.sh ui` adds the UI agent, `scripts/agents.sh docs` the documentation agent;
  `scripts/agents.sh core reviewer` or `… architect` starts only those.
  `scripts/agents.sh stop ui docs` ends those agents; `stop` alone ends every peer, never the
  architect or the pane it runs in. `DRY_RUN=1` prints the commands.

## Workflow

- One branch per topic, pull request into `main`. CI runs the unit tests and packages the `.ablx`.
- `npm test` (unit tests), `npm run build` (type-check + production bundle), `npm start` (run in
  Live — user only), `npm run package` (build the `.ablx`).
- Releasing, the pakabl index and CI are described in `docs/guides/`.
