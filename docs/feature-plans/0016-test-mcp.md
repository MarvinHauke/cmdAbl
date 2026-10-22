# Test access for agents: a `/run` route and a cmdAbl MCP server

**Status:** Draft (2026-10-22). Trigger: every Live test needs the user to type the commands; the
user wants the agents to run test lists themselves.

**Parent:** [0004](0004-command-platform.md)
**Related:**
- [0011](0011-logging.md): results and log lines are what a test reads;
- [0012](0012-vol-and-dca.md): `vol` logs before → after, the first command to test this way.

## Context

- Agents can read the logs and measure the bridge (`GET /bridge`), and they can open the palette
  (`/open`) through the local trigger server (`src/httpTrigger.ts`, port 27184, local only, browser
  pages refused). They cannot type into the palette, click a dialog or see the screen.
- `runLine(input, deps)` (`src/core/run.ts`) already runs one line. Its UI comes in through
  `deps` (`pick`, `pickTags`, `takeFill`) and the module `Ui` (`prompt`, `select`, `notify`,
  `board`, `page`).
- **Done means:** a builder runs its Live test list against the user's open test Set through MCP
  tools and reports what passed. The user checks only what needs eyes or hands.

## Design

```
agent ──MCP (stdio)──> tools/mcp/cmdabl-mcp ──HTTP 127.0.0.1:27184──> extension (npm start)
                                                                        └─ bridge ─> Remote Script
```

### 1. Headless run (core)

- `runLine` with a headless set of deps and a headless `Ui`. No dialog opens:
  - `pick` and `pickTags` resolve as "ambiguous": the run ends with exit 4 and the candidates in
    the message. It must not be "cancelled", so a test sees why.
  - `prompt`, `select`, `board` and `page` (including `api.confirm`) resolve null. The command
    gets "cancelled", and the outcome says a dialog was needed.
  - `notify` is captured into the outcome instead of shown.
- **Outcome:** `{ code, message, log: string[], dialogs: string[], ms }`.
  - `log` holds the lines the run wrote (from the logger's ring buffer, by run).
  - `dialogs` names any surface the command tried to open.
- Each run is one undo step, as in the palette. A headless run is not added to the history.
- **Reuse:** the headless deps are the same piece a future non-interactive caller needs; keep them
  in core (`src/core/headless.ts`), not in the route.

### 2. The route (core, `src/httpTrigger.ts`, `src/extension.ts`)

- `POST /run` with a JSON body `{ "line": "vol -6 #drums" }`. It answers with the outcome as JSON.
- `GET /log?n=120`: the last n lines of the ring buffer as JSON.
- **Development builds only:** `build.ts` defines a constant (e.g. `CMDABL_DEV_ROUTES`) that is
  false with `--production`. A production `.ablx` has neither route; a test asserts this.
- **Guards**, the same as `/reset` and more:
  - POST only;
  - `fromBrowserPage` refused;
  - a bearer token.
- **The token:**
  - The extension writes a random token, mode 0600, to `run-token` in its Extensions Data folder
    (next to `bridge-token`) at startup of a development build.
  - The MCP server reads that file.
  - The token never goes into a log line, chat or config (0011 rule 6).
- One run at a time: a second `/run` while one is running answers 409.
- A run while a palette or dialog is open answers 409 too, so the user's own work is not crossed.

### 3. The MCP server (`tools/mcp/`, owner: cmdabl-core)

- **Implementation:** a small Node script on `@modelcontextprotocol/sdk`, run with `tsx`, stdio
  transport.
- **Tools:**

  | Tool | What it does |
  |---|---|
  | `cmdabl_run(line)` | `POST /run`; returns code, message, log and dialogs |
  | `cmdabl_log(n)` | `GET /log` |
  | `cmdabl_bridge()` | `GET /bridge`: is the Remote Script connected, and how fast |
  | `cmdabl_state()` | `GET /state`: is a dialog open |

- **Read-only checks come later:** `cmdabl_read(path)` returns a track's dB, mute and tags without
  changing anything (`vol` and `tag -l` cover most of it today).
- **Registration:** in the project's `.mcp.json`, so every agent session gets the tools. When the
  extension isn't running, the tools answer "cmdAbl is not running (start it with npm start)" and
  never hang (timeout about 10 s).
- **Out of scope:** no MIDI, no screen capture, no clicking.

### 4. Rules for the agents (architect, `.claude/agents/*.md`, `CLAUDE.md`)

- Builders may run their Live test list through `cmdabl_run` **only when the user said a test Set
  is open and Live is free**. The user starts `npm start`; agents still never do.
- Every test run is logged. A builder reports what passed, and hands the rest to the user (how
  dialogs look, hand moves, Cmd+Z).
- Cmd+Z can't be pressed through MCP. Undo checks stay with the user, or use the log's `undo:`
  lines (`cmdabl log --undo`).

## Risks

| Risk | Fix |
|---|---|
| Any local process could run commands. | Development builds only, a 0600 token file, browser pages refused, localhost only. |
| Agents change the user's Set. | Only on the user's go, in a test Set; every run is logged; one Cmd+Z per run. |
| A command waits for a dialog forever. | The headless `Ui` never opens one; the route has a timeout (about 10 s) and answers 504. |
| Two agents run at once. | 409 while a run is going; the MCP tool says "busy". |
| The route drifts from the palette's behaviour. | Both call `runLine`; only the deps differ. Tests run the same lines through both. |

## Phased rollout

1. **cmdabl-core:**
   - the headless deps and `Ui` with tests (`pick` gives exit 4, a confirm gives "cancelled",
     notify is captured);
   - `POST /run` and `GET /log`, development-only, with token, busy and timeout tests;
   - a test that the production build has no route.
2. **cmdabl-core:** `tools/mcp/` with the four tools, `.mcp.json`, a test against a fake server.
3. **architect:** agent rules in the agent files and `CLAUDE.md`; the contributor guide gets a
   short "testing with MCP" section (cmdabl-docs, Develop section).
4. **User:** start `npm start` with a test Set, then restart the agent sessions so they load the
   MCP server. First run: `cmdabl_bridge`, then the `vol` test list.

## Verification

- `npm test` and `npm run build`; `npm run package` produces an `.ablx` without the routes
  (checked by a test on the bundle).
- Live (the user, once):
  - `cmdabl_run("vol -6 #drums")` returns code 0 and the before → after lines, and the faders
    move;
  - `cmdabl_run("goto Kick")` with two "Kick" tracks returns exit 4 and lists both, with no
    dialog;
  - while the palette is open, `cmdabl_run` answers busy;
  - with the extension stopped, the tool says so within about 10 s.
