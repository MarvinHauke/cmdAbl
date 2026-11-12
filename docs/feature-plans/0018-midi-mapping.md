# `map` and `midi`: MIDI controls run cmdAbl commands, toward a mapping matrix

**Status:** Page runs (live pages may run allowed command lines, `onClose`) released in 0.1.7 (PR #32). Trigger mode released in 0.1.5 (2026-11-05, PR #27; Remote Script 0.1.14): `map`, `map learn`,
`midi monitor`, the operators `press`/`release`/`hold`/`toggle`, live pages. Value mode, bindings that
open a page, per-control thresholds and the matrix are open. Public since 2026-11-03 (kept private as
0014 until then).

Trigger: the user wants a small mapping tool that binds a controller to **any cmdAbl command line**.
Later it grows into a matrix like the XOR NerdSEQ mapping editor. Examples:

```
map CC37 | mute #drums --set 0       # a button runs a command
map learn | vol #synth              # learn the control; its value drives vol
```

**Parent:** [0004](0004-command-platform.md)
**Depends on:**
- [0008](0008-tags-and-aliases.md): tags as targets;
- [0011](0011-logging.md): quiet runs and log lines;
- [0012](0012-vol-and-dca.md): `vol`, needed for value mode;
- the `Song.set_data` spike of [0013](0013-set-note.md);
- [0015](0015-link.md): `link`, named controls with rules at the limits.

## Context

The reference is the NerdSEQ mapping editor (XOR Electronics; the user's branch `marvin`): 70 rows
of source → destination, about 15 source and 17 destination types, learn, a static analyser,
comments and undo. That is the direction, not a spec.

Constraints:
- The Extensions SDK has **no MIDI input** (`docs/sdk-tree.md`). Only the Remote Script receives MIDI.
- Commands live in the extension, so a binding runs where the commands are.
- A dialog cannot call the extension while it is open.
- Messages go extension → script only today (UDP request/reply).

## Answers (user's questions, 2026-10-21)

**Is a controller set in Live?** Yes, as **cmdAbl's input port**.
- A Remote Script receives only from the input port chosen in its row under Settings → Tempo &
  MIDI → Control Surface. cmdAbl has that row already, for the bridge.
- The user picks the controller as its Input, and as its Output for feedback later.
- The LOM can neither set nor read that port, so the choice stays in Live.
- One row is one port. A second controller needs a second cmdAbl row. That is deferred, because the
  bridge's fixed UDP port lets only one instance bind.

**The Remote Script path vs Live's own MIDI mapping** (a port with "Remote" on, plus Cmd+M):

| | Live's MIDI mapping (Cmd+M) | cmdAbl via the Remote Script |
|---|---|---|
| Target | one parameter per control | any command line: tags, `!#`, several tracks, mute/solo/arm/goto/next/tag… |
| Tags | no | resolved when the control moves, so a newly tagged track follows |
| Buttons | toggle one parameter | run any command (`--set 0`, `find next`, `goto /Lead`) |
| Feedback | Live's own | later: LEDs and motor faders via `send_midi` |
| Saved | in the Set | bindings in the Set, the controller profile in cmdAbl |

**The structure of a controller: three layers**, which become the rows of a future matrix.

| Layer | What it is | Where it lives |
|---|---|---|
| **Control** | the hardware control: a name ("Fader 1"), type (cc, note, pitch bend), channel, number, kind (absolute, relative, button) | a **controller profile** in cmdAbl's folder, global, because the hardware doesn't change per Set |
| **Binding** | control → command line, with a mode (trigger or value) and a transform (threshold, range, invert, curve) | **in the Set** (`Song.set_data`), because what a fader does depends on the song |
| **Engine** | receives MIDI, decides when to run, runs the command without dialogs | the Remote Script (MIDI in, push) plus core (runs command lines) |

**Modules: separate, split by job.**

| Owner | Job | Commands or pieces |
|---|---|---|
| `midi` module | sources and controls | `midi monitor` (what arrives), `midi name CC37 "Fader 1"`, `midi learn`, `midi -l` |
| `map` module | bindings | `map <control> \| <command>`, `map learn \| <command>`, `map -l`, `map --rm <n>` |
| core | the engine | commands live in many modules, so only the platform may run a bound command line |
| bridge | the script side | script MIDI in and the push to the extension |

The matrix page later sits on top of `map`.

## Design (draft)

- **Engine flow:**
  1. The script forwards the mapped controls (`forward_midi_cc`/`forward_midi_note` in
     `build_midi_map`, then `receive_midi`).
  2. It **pushes** each event to the extension.
  3. The extension runs the bound command line.

  Mappings need the extension running. The first draft's goal "works without the extension" is
  dropped.
- **The push channel** (spike decides):
  - (a) an unsolicited UDP datagram from the script to the extension's bridge socket, reusing the
    protocol;
  - (b) an HTTP POST to the extension's local trigger server (`src/httpTrigger.ts`, a new `/midi`
    route), with the access token and the `fromBrowserPage` guard.

  Prefer (a) if the extension's socket stays open between requests.
- **Headless run** (core): `runLine(line, { interactive: false })`.
  - No dialogs: an ambiguous target gives exit 4, errors are logged, and no pick list opens.
  - Each run is one undo step, and runs stay out of the history.
- **Trigger mode:** a CC runs on the edge from below 64 to 64 or above (press, not release); a note
  runs on note-on. Covers `mute #drums --set 0`, `find next`, `goto`.
- **Value mode:**
  - A command declares which argument a control may feed: an additive `ArgDef.mapValue?: { min,
    max, unit }`.
  - CC 0–127 is scaled into that range.
  - Values are coalesced: the latest wins, about 30 Hz.
  - Needs `vol` (0012), so it comes after trigger mode.
  - `vol` is relative by default and absolute with `--set` (0012, user 2026-10-21). A fader
    (absolute control) binds to the absolute form: `map learn | vol #synth` runs
    `vol --set <value> #synth`. A relative encoder binds to the default relative form with a step
    per tick, which keeps the balance between the tracks.
  - **Bindings use the link layer (0015, user 2026-10-22).** A control drives a named control
    (`map CC37 | @drums`), and the link's rule decides what happens at a limit: `keep`, `stop` or
    `clip`. Pickup, scaling and curves are link rules too. A link's limits can be mapped values
    themselves (`--max @ceiling` on a second control), which allows layered mappings.
- **Syntax:**
  - `|` separates the control from the command line.
  - Core gets a "rest of the line" argument kind, so `map` receives the command raw and checks it
    by parsing it in a dry run.
  - Controls are written `CC37`, `CC37/ch2`, `N60` or `PB`. `map learn` takes the next message.
- **Learn under the dialog rule:**
  - `map learn` shows "Move a control, then press Enter".
  - On close, the extension asks the script `midi_last` for the newest message since the dialog
    opened.

## The simple version: trigger mode with operators (user, 2026-11-03)

Decisions:
- The push channel Remote Script → cmdAbl is approved, spike first. It also serves
  [0017](0017-scripts-and-triggers.md)'s triggers.
- Syntax: `map <control> [operator] | <rest of line>`. Everything after `|` is the binding, `;`
  included.
- Bindings are stored per Set first (`modules/map/<setid>.json` via `api.files` and the Set id, like
  `note`). Templates or a global layer come later.

### What was measured and decided (spike and v1, 2026-11-03/04, Faderfox UC4)

- **The push is an unsolicited UDP datagram sent straight from `receive_midi`** (median 0.2–0.5 ms,
  max 2 ms; HTTP took up to 48 s under fast knob moves and was dropped, as was holding to
  `update_display`). Events `{seq, type cc|note_on|note_off|pb, channel, number, value, time}` are
  accepted only from 127.0.0.1:27185; a note-on with velocity 0 counts as note_off. A command runs
  75–110 ms after the press.
- **Only bound controls are forwarded.** `midi_listen {controls, monitor, seconds}` forwards everything
  for learn and the monitor (default 30 s, max 120), then ends by itself; while it is open, track
  input and Cmd+M on that port pause. The last 50 messages are kept in a ring (`midi_last`). Every
  reply carries a `boot` id, so the extension re-sends the last listen after a script restart.
- **Press means value > 0, release means 0.** The UC4's buttons send 10 on press (not 127). **The
  user sets per-control thresholds himself later.**
- **Cmd+M wins:** a control mapped in Live isn't forwarded to the script. `forward_midi_cc` reports
  it, so `map` warns, `map -l` shows "⚠ taken in Live", the monitor lists "Taken in Live", and a later
  Cmd+M mapping logs a warning. After the Cmd+M mapping is removed, cmdAbl gets the control again
  without a new `map` (Live-tested).
- **Save the Set after the first `map`:** the first binding creates the Set id; without a save the
  bindings don't load after a restart (in the docs).
- **Live's status bar** shows incoming MIDI only with `"midi.statusBar": true` (default false, user
  2026-11-04); the monitor page is where values show. Its time column is off by default and returns
  as an option on the 0.1.6 MIDI settings page.

### Four layers

| Layer | What it is | v1 |
|---|---|---|
| **Control** | the hardware input: `CC37`, `N36`, optional `/ch2` | CC and note |
| **Operator** (connection type) | how a control's messages become runs of the command: when it fires and which value it hands over | `press`, `release`, `hold`, `toggle` |
| **Binding** | the command line, with `{}` where the operator's value goes | any line, `;` chains included |
| **Engine** | MIDI in (Remote Script) → push → operator state → `runHeadless` | yes |

### Operators (v1)

| Operator | Fires on | `{}` becomes | Use |
|---|---|---|---|
| `press` (default) | note-on, or CC crossing up to 64 or above | — | `map N36 \| next` |
| `release` | note-off, or CC falling below 64 | — | completes `press` |
| `hold` | press and release | 1 on press, 0 on release | momentary: `map N36 hold \| mute #drums --set {}` |
| `toggle` | each press | 1, 0, 1, … (state per binding) | latching: `map CC37 toggle \| solo #lead --set {}` |

- **A hardware toggle** (a button set to toggle on the controller, like the UC4's CC 51, sending 10 then
  0 on the next press) needs no cmdAbl `toggle`: `hold` mirrors the hardware state (1 while the value
  is above 0, 0 at 0). A named alias such as `follow` could make that clearer later (user, 2026-11-03).
- **Later operators,** same slot: `value` (absolute, scaled into a range, coalesced at about 30 Hz),
  `step` (relative encoders), `range a b`, `curve`, `invert`, `pickup`. They lead into value mode and
  then into the matrix's step chain.
- An operator is a pure function `(message, state) → [fires, value]`.
- `{}` with `press` or `release` is an error (exit 2, "press gives no value; use hold or toggle").

### Commands (v1)

```
map CC37 | mute #drums --set 0
map N36 hold | mute #drums --set {}
map CC37/ch2 toggle | solo #lead --set {}
map learn toggle | mute #fx --set {}   # subcommand, so the platform parses the operator
map -l
map --rm 2
map --off / map --on                 # settings.json map.enabled
midi monitor                         # live view of incoming messages
```

### How the modules behave (built in 0.1.5)

- Binding the same control and operator again replaces the line; the first word of the line must be
  a registered command.
- `map learn` is a live page that closes about 150 ms after the first control moves; Enter and Esc
  still work. `map -l` shows numbered rows; `map --rm <n>` completes from them; `map --on/--off` is
  the `map.enabled` setting.
- Bindings live in `modules/map/<setid>.json`; a damaged file is never overwritten (exit 1, warning).
  They load on `api.onSetChange` and before every `map` command.
- **Set changes:** core polls the script's `set_id` read-only every 3 s (10 s while the script doesn't
  answer). Known limits: two Sets without an id look the same, and A → B → A within one poll goes
  unseen.

### Later: bindings that open a page (user, 2026-11-05)

`map CC48 toggle | note` runs but shows nothing: bound lines are headless, so a dialog counts as
cancelled. The user wants controls that open pages (`note`, `tag -l`). Open design: opt-in per binding
or per command, one dialog at a time, never while a dialog is open. See STATUS backlog.

### Live pages (user, 2026-11-04: the localhost variant)

**The rule and its exception** (`CLAUDE.md`):
- **The default stays:** a dialog gets JSON in and returns one string, and writes into Live happen
  through a command after it closes.
- **What that keeps:**
  - pages stay simple;
  - writes stay in one place, with undo, history and logging;
  - release builds expose no Set data;
  - a hung page can't hurt cmdAbl;
  - pages can be tested without Live.
- **The exception, a live page, may only read while open.**

**Rules for a live page:**
1. **Served from `http://localhost:27184/live/<page>?t=<load token>`, with two tokens per dialog,
   each about 128 bits** (reviewer, 2026-11-04):
   - **the load token** is in the URL and loads the page once, then it's dead;
   - **the route token** is written only into the served HTML (`LIVE.token`) and is the only
     `Authorization: Bearer` accepted.

   A dialog URL that Live or WebKit might log or cache is then worth nothing. Neither token is ever
   logged. The routes exist only while that dialog is open and are revoked when it closes.
   - **`localhost` resolves to `::1` first:** the server binds `[::1]:27184` too for `/live/`, so no
     other local process can take that address. If that fails, the data-page fallback applies.
2. **Checks on every route:**
   - origin `http://localhost:27184` exactly;
   - the token, compared in constant time;
   - GET only, read-only;
   - small JSON answers.
3. **The page polls** about every 100 ms (spike: rtt 1–2 ms, smooth). It needs no websocket.
4. **Fallback:** if the server can't be reached, the page works as a normal page (learn reads on
   Enter, the monitor shows its snapshot) and says "live view unavailable".
5. **In core:** core owns the route registration (`api.ui.livePage(name, html, size, routes)`, an
   additive ModuleApi change). Modules declare read functions; core serves them under the token.
6. **Tests:** pages are checked in a browser with a fake live source, the same interface as the server.

**Long polling (user, 2026-11-04):** instead of a fixed 30 ms timer, the page sends a request with
`since`. cmdAbl holds it until a newer message arrives (at most 1 s), then answers at once. Values show
without delay, and an idle page makes about one request per second. Waiting routes are capped at 1 s;
plain routes keep the 100 ms budget.

**First live pages:**
- **`midi monitor`:** the last messages update live (one row per control, updated in place), and the
  status bar keeps working. A section "Taken in Live: CC51 ch1 …" lists the controls Live refused to
  forward during the window (Cmd+M or another control surface), so the user sees them before binding
  (user, 2026-11-04).
- **`map learn`:** the page closes by itself on the first control that moves, after a short debounce of
  about 150 ms. The page shows the control before closing. Enter and Esc still work.
- **Later:** the completion server (plan 0006) on the same mechanism.

Built in 0.1.5 (core `livePage`, ui `live.js`, the monitor and learn pages).

### Page runs: a live page may run allowed command lines (user, 2026-11-11)

Since 2026-11-12 page runs are one kind of inner run ([0028](0028-inner-runs.md)): one engine, the page's `run` list narrows the command's declared `runs`.

From the note's stamps (0013): closing and reopening a page around every write flickers and loses
the keys typed in between. The exception is widened, without a second write path:
- **The module allows command lines when it opens the page:** `livePage(…, routes, { run: ["loop here", "loop back"], onClose: "loop back" })`. An entry is a command path (command plus subcommands); the page may run a line
  only if its parsed command path is in the list. Options and arguments are free.
- **The page posts** `POST <base>/run` with `{ line }`, using the same route token, origin check and
  the dialog's lifetime as the read routes. The answer is `{ code, text }` (the `CommandResult`).
- **It runs through the normal command path:** parse, resolve, one undo step, the log, errors caught,
  headless (no dialogs; a part that would ask gives exit 4). Not added to the history. It runs as a
  nested run while the opening command still waits for its dialog, so it must not wait on that run.
  While a page run is in flight the surfaces are shut like in any headless run, so a palette opened in that
  short window is dismissed (known).
- **`livePage` resolves only after the page runs in flight for that dialog have finished** (reviewer, 2026-11-11): a quick `s` then Cmd+S must not let the module's safety net run before the stamp is done. Runs that arrive after the close get 404.
- **`onClose` is the module's safety net:** after the close and the in-flight runs, core runs that one line once, but only if the page made at least one page run (not for a plain read, a data page or a close without runs); then whatever it answered, also a dismiss. Same rules as a page run (its path must be in `run`, else refused with a warn line; headless, logged, errors caught, not in the history); its result is only logged.
- **A page without the server** (`LIVE = null`) falls back to what it did before (for the note: close
  with `then` and reopen).
- What stays: the dialog still answers one string when it closes; anything not in the list is refused
  (exit 2 to the page, a warn line in the log).

### Syntax rules (v1)

- `|` outside quotes is reserved. In `map` it starts the raw binding line, which `;` doesn't split.
  In every other command a bare `|` is a usage error (exit 2), e.g. `note buy milk | eggs` or
  `find a|b`. Quote it or write `\|`. Old history entries with a bare `|` fail the same way. This
  goes into the release notes next to the `;` change (core, 2026-11-03).
- Learn is a subcommand, `map learn [operator] | <line>`, so the platform parses the operator: with
  `--learn` there would be no control word and the operator would land in the control slot.

### Engine rules (v1)

- **Running:** a bound line runs headless: no dialogs, exit 4 on ambiguity, one log line per firing,
  not added to the history, one undo step per part.
- **Overlap:** a firing that arrives while the same binding still runs is dropped for `press`,
  `release` and `toggle`; `toggle` advances only when a run starts. For `hold`, the latest dropped value
  is kept (a newer one replaces it) and runs once when the current line finishes, so a quick tap's
  release is never lost and the end state matches the hardware (reviewer, 2026-11-03).

## Phased rollout

1. ~~Spike, bridge (`midi_listen`, `midi_last`, the UDP push), core (intake, operators, headless runs,
   the `|` rest-of-line argument), modules (`map`, `midi monitor`), live pages, docs~~ — released in
   0.1.5.
2. **Value mode:** `ArgDef.mapValue` plus `vol` (0012), so `map learn | vol #synth` works; operators
   `value`, `step`, `range`, `curve`, `invert`, `pickup`.
3. **Bindings that open a page** (user, 2026-11-05) and per-control press thresholds.
4. **Later:** relative encoders, feedback (`send_midi`), a second controller, a template or global
   layer, the matrix page with conflict checks and comments.

## The matrix (later): what to take from the NerdSEQ editor, made friendlier

Looked at in the user's running editor (localhost:5173) and its format spec, 2026-10-21.

**How NerdSEQ works:**
- 70 numbered rows run in order, about 1000 times a second.
- Each row is source type → function → extra → destination.
- The logic lives in **Calc** rows, about 45 functions on two operands A and B. An operand is a
  constant 0–8, a threshold, a variable A–P, or the value of another row by number.
- **Skip** rows are conditional jumps ("skip 3 rows if A > B").
- Variables are the wires between rows.
- It is powerful, but you need row numbers, hex, cryptic codes (`MUL!`, `SHTR`) and jumps.

**The cmdAbl version: the same ideas in plain words.**
- **Event-driven, not a loop:** a row is evaluated when its input changes (a control moves, or a
  value it depends on changes).
- **Names instead of numbers:** rows, controls and values have names (`fader1`, `$level`), and
  operands are picked by name.
- **No jump rows.** Each row has an optional **When** condition instead.
- **A row reads left to right:**
  `When` (optional) → `Input` (a control or a named value) → `Steps` (a short chain of transforms)
  → `Do` (a cmdAbl command line, or "store as $name") → `Note`.
- **Steps**, grouped like a menu:

  | Group | Steps | NerdSEQ equivalent |
  |---|---|---|
  | Shape | range (min/max), invert, curve, steps (quantize) | — / INV |
  | Math | + − × ÷ with a number or a named value, min, max | ADD SUB MUL DIV MIN MAX |
  | Compare | above, below, equal, between → on/off | IF <, >, =, … |
  | Logic | and, or, not, either (of two on/off values) | LAND L OR DINV LXOR |
  | Remember | toggle (each press flips), hold (sample & hold, track & hold), count up/down | LFLP FLG^ S&H T&H CNT INC DEC |
  | Gate | pass the value only while a condition is on | PASS |

  Bitwise operations, overflow variants, shifts and skip rows are left out: they suit a 12-bit
  hardware engine, not a mixer.
- **Named values (`$name`)** replace variables A–P. A row can store its result, and other rows read
  it. `$` keeps them apart from `#tags`.
- **Checks, as in the NerdSEQ analyser:**
  - a value read but never written;
  - two rows driving the same target;
  - a loop between rows.

  They are shown inline on the matrix page, not in a separate report.
- **Example:**
  > When `shift` is on · Input `fader1` · Steps: range -40…0 dB · Do `vol --set {} #drums`
  > Input `button3` · Steps: toggle · Do `mute #fx --set {}`
- **The text form stays the source of truth:** every matrix row is also a `map` line, so the
  palette and the matrix edit the same thing. A row with steps would read
  `map fader1 | range -40 0 | vol --set {} #drums`.

### Direction (user, 2026-10-21): take only the major concepts

**Kept from NerdSEQ:**
- source → transform → destination as plain data;
- learn;
- named state that rows share;
- conditions;
- the static checks.

The 70-row grid, the 1 kHz loop and the function catalogue are not copied.

**Done the modern way:**
- **Composable pipelines,** like the shell: each step is a small, testable function, chained with
  `|`. cmdAbl already uses `|` for `map`.
- **Reactive:** a step reruns only when its input changes.
- **The matrix page is a view, not the model:** a list of rule cards to edit, with a grid only as
  an overview for conflicts.

**NerdSEQ functions that become ordinary cmdAbl modules or core features,** useful without any
controller (overlap with the ClyphX ideas in 0009):

| NerdSEQ | cmdAbl | Owner |
|---|---|---|
| variables A–P | **named values** `$name`: `set $level -6`, then `vol --set $level #drums` | core (with the 0.1.3 store) |
| sample & hold, track & hold | **snapshots**: `snap save verse`, `snap recall verse` (mixer, mute, devices) | module (0009 snapshots) |
| count, inc/dec | **step through lists**: scenes, presets, `next`/`prev` beyond `find` | module |
| random | **randomize within a range**: `vol --rand -12 0 #drums` | an option on value commands |
| compare, if | **conditions** in action lists: `if $mode = 2 ; …` | core (0009 `;` lists) |
| global pulse, BPM, run | **triggers from Live:** on play, on a scene, on a locator | module (0009 triggers) |
| min, max | **limits** on value commands (`vol` clamps already) | each command |

So `map` stays thin: a control plus a pipeline of these same commands and steps.

## Resolution for volume (the user's controller: Faderfox UC4, 2026-10-21)

**The problem:**
- Live's volume parameter is 0…1, with 0 dB at about 0.85 and +6 dB at 1.0, on a strongly
  non-linear curve.
- A 7-bit CC mapped linearly to it (what Cmd+M does) gives fine steps near the top and coarse
  steps of several dB below about -40 dB.

**The default fix, for 7-bit controls:**
- Don't map the CC to the parameter. Map it to **dB** with a mixing curve, then convert dB to the
  parameter value with the shared dB↔value helper (0012).
- The default step `fader`, the step `vol` uses when a control feeds it:
  - CC 0 = -inf;
  - CC 1…127 = -60 dB … +6 dB, linear in dB, so about 0.5 dB per step everywhere;
  - optionally a "fader law" variant: finer around 0 dB, coarser below -40.
- The mapping can be adjusted with `range` and `curve`.

**Better resolution:**
- **14-bit:** NRPN (CC 99/98 for the address, CC 6/38 for the value) or pitch bend gives 16384
  steps.
  - The script assembles NRPN from the four forwarded CCs.
  - Pitch bend is forwarded natively (`forward_midi_pitchbend`).
  - The spike checks that the UC4 sends 14-bit values on faders and encoders (Faderfox manual).
- **Relative encoders** (UC4 encoders in relative mode) avoid the problem entirely: each tick is a
  fixed dB step (`vol <step>`), unlimited fine. This is the natural use with the relative `vol`.

**Takeover:** pickup by default, so a fader does not jump the level when it doesn't match. A
14-bit or relative control makes pickup rarely noticeable.

- **Idea (user, 2026-11-11): a knob scrolls a list.** `find --at <n>` selects the n-th match; in value mode
  `map CC12 | find --at {}` turns a knob into a list scroller. Needs value mode and an `--at` option.

- **Monitor findings (user, 2026-11-12):**
  - The monitor shows that it listens, extends its listening window by itself while the page is open, and
    says so when it stopped (never silent).
  - "All ins" like Live's input menu: a Remote Script gets MIDI only from its own control-surface Input.
    Spike first: (1) can the Remote Script read other ports, (2) Web MIDI in Live's dialog web view (the
    NerdSEQ editor used Web MIDI in Chrome; WebKit has none), (3) a native MIDI module in the Extension
    Host (sandbox?). Without one of them the monitor names its Input and where to change it.

## Open questions

- Where `map` goes in the public order (`note`, then `vol`, then `dca`). `vol` gates value mode
  only; trigger mode can start earlier.
- Global controller profiles vs per-Set bindings: does a binding also need a global fallback, for a
  controller that is always connected?

## Verification

- Every phase: `npm test`, `npm run build`, the Python tests.
- Live:
  - `map CC37 | mute #drums --set 0`: the button unmutes every drums track, including a track
    tagged afterwards;
  - `map learn | next` binds the control you move;
  - an ambiguous command bound to a control opens no dialog and logs exit 4;
  - bindings survive saving and reopening the Set;
  - value mode: `map learn | vol #synth`, and the fader follows smoothly.

## Order note (user, 2026-10-22)

- Device on/off (`bypass`, see STATUS) and the hierarchy of the `mute` listing come after the simple
  mapping (trigger mode) in the roadmap.

## Later building block: instrument parameters by name (user, 2026-10-22; comes way later)

One command for every instrument, hardware or software. It is the natural target for value mode, but it comes
well after trigger mode and value mode.

```
param "/Sub 37 MIDI" cutoff 80                # hardware: name → CC from the MIDI Guide data
param /Lead/Wavetable "filter 1 freq" -10%    # software: the device's own parameter (SDK)
```

| Instrument | Parameter source | How it's set |
|---|---|---|
| Hardware (Sub 37, Minilogue, SH-101, drum machines, effects) | MIDI Guide CSV (Pencil Research, `pencilresearch/midi`, fork `MarvinHauke/midi_pencilresearch`): manufacturer, device, section, parameter name, CC MSB/LSB, NRPN, range | CC/NRPN sent through the Remote Script to the track's MIDI output (spike) |
| Live instrument or plug-in | `device.parameters[]` by name (SDK) | written directly, one undo step |

- **Shared behaviour:** name completion (CSV names or device parameter names, shown in the hint panel),
  relative steps and limit rules as for `vol` (`stop`, `--clip`, later `link` rules), and percent or raw
  values.
- **For the mapping:** a control drives "cutoff" on whatever instrument sits on a track, by name, without
  CC numbers.
- **License:** the MIDI Guide data is CC-BY-SA 4.0. Don't bundle it into the `.ablx`: download it on
  demand into the data folder (like pakabl's index), with attribution. Any changed copy of the data
  stays CC-BY-SA; cmdAbl's code license is unaffected.
- **Open questions:**
  - Sending CC/NRPN from the Remote Script: does it need the track's MIDI output port, and is it
    reachable from a Remote Script?
  - Assigning a track to a CSV device: match once by name, set by hand, or a tag such as `#synth:sub37`.
  - Name matching against CSV parameter names (sections, aliases, fuzzy).
  - 14-bit CC (MSB+LSB) and NRPN.

## The Session grid as the mapping matrix (user, 2026-10-23)

Plan [0017](0017-scripts-and-triggers.md) (scripts and triggers) runs `.cmdabl` scripts when a clip or scene launches. For this
plan that is the matrix the user was looking for: tracks are columns, scenes are rows, and every clip slot
is a cell holding a script. Launch quantization, follow actions, the visual grid and Launchpad control
come from Live itself. 0017 is first in the order (user, 2026-10-23). The script → cmdAbl push it needs
is the same channel as this plan's engine (the "push channel" spike), so it is built once for both.
