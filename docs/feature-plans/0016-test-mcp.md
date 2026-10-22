# Test access for agents: a `/run` route and a cmdAbl MCP server

**Status:** Built (core `d8fd4b9`, `3512336`, `a952068`), Live-tested 2026-10-22 (after `0812943`: Live's host has no global `URL`), on `feat/test-mcp` (based on `feat/vol`). Trigger: every Live test needs the user to type the commands; the
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
  - The platform's `pick` and `pickTags` resolve as "ambiguous": the run ends with exit 4 and the
    candidates in the message. It must not be "cancelled", so a test sees why. A module's own
    `api.pick` is only dismissed and named in `dialogs` (as built, d8fd4b9).
  - `prompt`, `select`, `board` and `page` (including `api.confirm`) resolve null. The command
    gets "cancelled", and the outcome says a dialog was needed.
  - `notify` is captured into the outcome instead of shown.
- **Outcome:** `{ code, message, log: string[], dialogs: string[], notices: string[], ms }`
  (`notices`: captured `notify` texts).
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

### 5. Screenshots for the docs (user, 2026-10-22; built: core `f865d5f`)

The agents can make documentation images themselves, so images follow the code in the same change.

- **`POST /show {line}`** (development builds only, same guards and token as `/run`): runs one line
  *interactively*, the same as typing it in the palette, so its dialogs open. It answers at once with
  `{ started: true }` and does not wait for the dialog to close. `{ line: "" }` opens the empty
  palette. 409 while a dialog is open or a run is going.
- **MCP tools** (`tools/mcp/`):

  | Tool | What it does |
  |---|---|
  | `cmdabl_show(line)` | `POST /show` |
  | `cmdabl_keys(text?, key?)` | Brings Live to the front and, in one script, types `text` (printable, 1–200 characters) and/or presses one `key` from the allow-list `escape`, `return`, `tab`, `up`, `down`, `left`, `right`, `delete`, `space`, `cmd+s`, `cmd+z` through System Events. Nothing is typed unless Live is frontmost **and** its topmost window is a cmdAbl dialog (not the main window), so keys never reach the Set. Needs Accessibility for the terminal app. |
  | `cmdabl_capture(name, target)` | Captures one window with `screencapture -l <window id>`: `target` `dialog` is the frontmost cmdAbl dialog, `live` is Live's main window. Window ids come from `CGWindowListCopyWindowInfo` (via `osascript -l JavaScript`), filtered by Live's process. It writes `captures/<name>.png` (gitignored), never the full screen, and returns the path and size. |

- **Never the full screen**, and only windows owned by Live. If no matching window is found, the tool
  says so and captures nothing.
- **Editing and review:** `cmdabl-docs` crops, covers hardware or private names with opaque boxes
  (ImageMagick), moves the image to `docs/assets/images/`, and the reviewer checks every image
  before a commit (the rules in `.claude/agents/docs.md`).
- **One-time setup (user):**
  - Screen Recording for the terminal app (already granted);
  - Accessibility for the terminal app (System Settings → Privacy & Security → Accessibility);
  - the first `cmdabl_keys` call asks to allow control of "System Events" (Automation).

### 6. Recordings for the docs (user, 2026-10-22)

- **`cmdabl_record(name, seconds)`** (1–30 s): brings Live to the front, reads the bounds of Live's main
  window (as `cmdabl_capture` does), and starts `screencapture -v -V <seconds> -R x,y,w,h
  captures/<name>.mov` in the background. It answers at once; the actions follow with `cmdabl_show` and
  `cmdabl_keys`. `cmdabl_record_status(name)` says whether it is still recording and the file size.
- **Pacing:** `cmdabl_keys` gets an optional `delayMs` per character (0–300, default 0), so typing can
  be followed in a recording.
- **Conversion:** `cmdabl_convert(name, format: "mp4"|"gif", width?, crop?)` runs `ffmpeg` on
  `captures/<name>.mov` → `captures/<name>.mp4|gif` (mp4: H.264, CRF about 24, no audio; gif: a palette
  pass, about 12 fps). The output stays in `captures/`; docs moves the final file.
- **Limits:** a recording is a screen area, not a single window: whatever covers Live (notifications,
  other windows) is recorded too. The user turns on Do Not Disturb; docs checks every frame of the
  result before it is committed. Keys only, no mouse.

## Risks

| Risk | Fix |
|---|---|
| Any local process could run commands. | Development builds only, a 0600 token file, browser pages refused, localhost only. |
| Agents change the user's Set. | Only on the user's go, in a test Set; every run is logged; one Cmd+Z per run. |
| A command waits for a dialog forever. | The headless `Ui` never opens one; the route has a timeout (about 10 s) and answers 504. |
| A run hangs past the timeout and keeps the gate closed. | `POST /reset` releases the run gate and the route ("run gate released", core `a952068`). Known edge: a released run that wakes up later may open a real dialog or land in a newer run's capture; rare, fixed only if it shows up. |
| A capture shows something private. | Only Live's own windows by id; images go through docs (opaque boxes) and the reviewer before a commit; `captures/` is gitignored. |
| Keys reach the wrong app or the Set. | `cmdabl_keys` types only when Live is frontmost and its top window is a cmdAbl dialog. Known edge: another small Live window on top (a plug-in window, Settings) also passes; low risk. |
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
