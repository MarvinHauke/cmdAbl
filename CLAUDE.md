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
- A dialog gets JSON in and returns one string when it closes; it cannot call the extension while
  open. Extensions cannot call each other.
- Keep plans, README and code in sync in the same change.

## Agent team

Peer Claude sessions that message each other (`SendMessage`), watchable in tmux:

| Name               | Agent file                    | Model  | Job                                                        |
| ------------------ | ----------------------------- | ------ | ---------------------------------------------------------- |
| `cmdabl-architect` | `.claude/agents/architect.md` | opus   | lead; tasks, plans, contract decisions, Live test lists    |
| `cmdabl-core`      | `.claude/agents/core.md`      | sonnet | the platform (`src/core/`, registry, module interface)     |
| `cmdabl-modules`   | `.claude/agents/modules.md`   | sonnet | commands as modules (`src/modules/`), authoring guide      |
| `cmdabl-bridge`    | `.claude/agents/bridge.md`    | sonnet | Live access (`src/ableton/`, `remote-script/`)             |
| `cmdabl-reviewer`  | `.claude/agents/reviewer.md`  | opus   | read-only review against the plans and SDK limits          |
| `cmdabl-ui`        | `.claude/agents/ui.md`        | sonnet | dialogs and themes (`ui/`) — **on demand**                 |

Flow: architect → builder → reviewer (→ architect for contract decisions) → builder commits →
short overview with a Live test list to the architect → the user tests in Live.

- **One agent per area.** Tasks name the files an agent owns; before editing, check
  `git diff <file>` and don't touch a file with another agent's uncommitted changes; stage only
  your own files (no `-A`, no interactive `-p`). `src/modules/types.ts` is edited by `cmdabl-core`
  only.
- **Nobody can test in Live but the user**, and only one Extension Host connects at a time. Agents
  never run `npm start`; they run `npm test` and `npm run build` and hand over a test list.
- **Only the architect pushes or opens pull requests, and only when the user asks.**
- `scripts/agents.sh` opens core, modules, bridge and reviewer in one tmux window `cmdabl-agents`
  and starts the architect in the current pane, resuming each by the session id in its agent file.
  `scripts/agents.sh ui` adds the UI agent; `scripts/agents.sh core reviewer` or `… architect`
  starts only those; `DRY_RUN=1` prints the commands.

## Workflow

- One branch per topic, pull request into `main`. CI runs the unit tests and packages the `.ablx`.
- `npm test` (unit tests), `npm run build` (type-check + production bundle), `npm start` (run in
  Live — user only), `npm run package` (build the `.ablx`).
- Releasing, the pakabl index and CI are described in `docs/guides/`.
