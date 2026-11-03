# `map` and `midi`: MIDI controls run cmdAbl commands, toward a mapping matrix

**Status:** Draft, reworked (2026-10-21); public since 2026-11-03 (it was kept private as 0014 until then).
The simple version (trigger mode with operators, below) is next; nothing is built yet.

Trigger: the user wants a small mapping tool that binds a controller to **any cmdAbl command line**.
Later it grows into a matrix like the XOR NerdSEQ mapping editor. Examples:

```
map CC37 | mute #drums --set 0       # a button runs a command
map CC --learn | vol #synth          # learn the control; its value drives vol
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
| Buttons | toggle one parameter | run any command (`--set 0`, `next`, `goto /Lead`) |
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
| `map` module | bindings | `map <control> \| <command>`, `map --learn \| <command>`, `map -l`, `map --rm <n>` |
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
  runs on note-on. Covers `mute #drums --set 0`, `next`, `goto`.
- **Value mode:**
  - A command declares which argument a control may feed: an additive `ArgDef.mapValue?: { min,
    max, unit }`.
  - CC 0–127 is scaled into that range.
  - Values are coalesced: the latest wins, about 30 Hz.
  - Needs `vol` (0012), so it comes after trigger mode.
  - `vol` is relative by default and absolute with `--set` (0012, user 2026-10-21). A fader
    (absolute control) binds to the absolute form: `map CC --learn | vol #synth` runs
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
  - Controls are written `CC37`, `CC37/ch2`, `N60` or `PB`. `--learn` takes the next message.
- **Learn under the dialog rule:**
  - `--learn` shows "Move a control, then press Enter".
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

### Spike results (Live test 2026-11-03, Faderfox UC4 as cmdAbl's input)

| Path | Median | Max |
|---|---|---|
| **UDP sent from `receive_midi`** | **0.2–0.5 ms** | **2 ms** |
| UDP held to `update_display` | 53–58 ms | 99 ms |
| HTTP POST | 950 ms – 34 s | 48 s (the queue backs up under fast knob moves) |

- **Decision: the push goes as an unsolicited UDP datagram, sent straight from `receive_midi`.** HTTP is
  dropped, and so is holding to the display tick.
- MIDI arrives on cmdAbl's input port (map built: 4112 controls in 1–11 ms). The encoder (CC 104)
  delivers the full range. The existing bridge still answers (median 46 ms).
- **The UC4's buttons send 10 on press and 0 on release (CC 51), not 127.** Both edges arrive. For v1,
  press means value > 0 and release means 0. **The user wants to set these values per control
  himself later** (a threshold or value setting on the operator).
- **Cmd+M still learns a control while cmdAbl forwards it** ("1/51" learned on a clip slot), with
  "Remote" on for the input port. **Open:** do Live's mapping and cmdAbl both act on the same press?
  If they do, `map` should warn about controls that are also mapped with Cmd+M. Track input with
  notes is untested (the UC4 sends CCs).

### v1 channel (bridge `6f63615`, script 0.1.10)

- **Forwarding:** nothing is forwarded by default; `midi_listen {controls}` forwards only the bound
  controls.
- **The push:** only an unsolicited UDP datagram from `receive_midi` (spike: median 0.2–0.5 ms, max
  2 ms). HTTP and the `update_display`-held send are dropped.
- **Events:** `{seq, type cc|note_on|note_off|pb, channel 1–16, number, value, time}`. A note-on with
  velocity 0 counts as note_off.
- **The ring of the last 50 messages is always on.** `midi_listen {controls, monitor: true, seconds}`
  forwards everything for learn and `midi monitor` (default 30 s, at most 120), then ends by itself.
  While it is open, track input and Cmd+M on that port pause: Live gives forwarded messages only to
  the script. So learn and the monitor open the window, read `midi_last`, and close it again.
- **Robustness:**
  - every reply carries a `boot` id, and the extension re-sends the last listen after a script
    restart;
  - events are accepted only from 127.0.0.1:27185;
  - listeners survive a recreated bridge client.
- **Still open:** the map build time measured in Live's Log.txt ("map built: N controls in X ms").

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
map --learn toggle | mute #fx --set {}
map -l
map --rm 2
map --off / map --on                 # settings.json map.enabled
midi monitor                         # the last incoming messages
```

### Engine rules (v1)

- **Running:** a bound line runs headless: no dialogs, exit 4 on ambiguity, one log line per firing,
  not added to the history, one undo step per part.
- **Overlap:** a firing that arrives while the same binding still runs is dropped. `toggle` advances
  only when a run starts.

### Work (v1)

1. **Spike (cmdabl-bridge):**
   - MIDI in on cmdAbl's input port and whether forwarding blocks Live's own use of the port;
   - push via UDP datagram vs HTTP POST;
   - latency;
   - delivery of note-off and CC release.
2. **Bridge:** `midi_listen {controls}`, `midi_last {since}`, the event push (script 0.1.9).
3. **Core:**
   - event intake with the token;
   - operators and their state;
   - binding lookup and the in-flight guard;
   - `runHeadless`;
   - a rest-of-line argument after `|` that `;` doesn't split;
   - `{}` substitution.
4. **Modules:** `midi monitor`; `map` (add, operators, `--learn`, `-l`, `--rm`, `--on`/`--off`);
   storage; `midi_listen` on activation and on Set change.
5. **Docs:** "MIDI mapping" in using.md.

## Phased rollout

1. **Spike** (cmdabl-bridge):
   - MIDI in through cmdAbl's input port;
   - sharing that port with track input and with Remote/Cmd+M on the controls cmdAbl doesn't
     take;
   - a port a vendor script (Push, Launchpad) already uses;
   - the push channel, (a) or (b);
   - latency for 8 tracks;
   - `Song.set_data` survives save, reload and Save As (shared with 0013).
2. **Core:** event intake; headless `runLine`; edge detection and coalescing; the rest-of-line
   argument kind.
3. **Bridge:** `midi_listen` (the set of controls to forward), `midi_last`, the event push. Script
   0.1.7.
4. **`midi` module (small):** `midi monitor`, `midi name`, `midi -l`. The profile lives in
   cmdAbl's folder.
5. **`map` module, trigger mode,** with today's commands: add, `--learn`, `-l`, `--rm`. Bindings
   in the Set.
6. **Value mode:** `ArgDef.mapValue` plus `vol` (0012), so `map CC --learn | vol #synth` works.
7. **Later:**
   - relative encoders;
   - feedback (`send_midi`);
   - transforms;
   - a second controller;
   - the matrix page (`ui/modules/map/matrix.html`) with conflict checks and comments.

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
  - `map --learn | next` binds the control you move;
  - an ambiguous command bound to a control opens no dialog and logs exit 4;
  - bindings survive saving and reopening the Set;
  - value mode: `map CC --learn | vol #synth`, and the fader follows smoothly.

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
