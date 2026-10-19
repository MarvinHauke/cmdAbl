# Ideas from ClyphX

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0008](0008-tags-and-aliases.md) (tags, aliases, the store).

**Status:** Draft — idea list (2026-10-20). No builder tasks yet; an item starts when the user
picks it.

## Context

ClyphX ([ldrolez/clyphx-live11](https://github.com/ldrolez/clyphx-live11), LGPL Remote Script;
syntax in its [reference](https://github.com/ldrolez/clyphx-live11/blob/master/reference.md))
is a word-based action language for Live: `2/MUTE ON ; 3/ARM`, run from *triggers* in the Set
(clip names, locators, MIDI controls; ClyphX Pro adds Note Trigger Racks, where a pad or chain
name runs when a note hits it). cmdAbl is a palette you type into. Many concepts carry over; the
trigger side is a new direction. Concepts only — no code is copied.

## Concepts and where cmdAbl stands

| ClyphX | Example | cmdAbl today | Proposal |
|---|---|---|---|
| Toggle vs set | `MUTE`, `MUTE ON` | `mute`, `--set 1/0` | done |
| Track by number | `2/VOL >` | paths, names | index target `2` — 0.1.x |
| Selected track | `SEL/MUTE` | — | `.` as a target — 0.1.x |
| Ranges, all | `1-4/ARM`, `ALL/MUTE`, `SEL-"Bass"/…` | comma lists, `#tag` | `1-4`, `all` — 0.1.x |
| Relative to selection | `>/MUTE`, `</ARM` | — | later, with `.` |
| Action lists | `1/MUTE ON ; 2/ARM` | one command per line | `;` in a line — 0.1.2, with aliases (an alias is a saved action list) |
| Value changes | `VOL 50`, `VOL >`, `PAN <4`, `RESET`, `RND50-60` | — | `vol` / `pan` / `send` module: absolute, `+n` / `-n`, `reset` — 0.1.x |
| Devices | `DEV2 ONOFF`, `DEV1.1`, `DEV"Auto Filter"` | paths to devices | on/off for device paths — 0.1.x |
| Scenes, clips | `SCENE >`, `1/CLIP2 …` | — | play/stop scenes and clips — later |
| Snapshots | `1-4/SNAP DEVALL MIX+` | — | `snap save/recall <name>` (mixer and device parameters), stored in the Set with `set_data` — 0.2.x |
| Variables, sequences, waits | `%v%`, `(PSEQ) …`, `WAIT 10` | — | alias arguments (`$1`) in 0.1.2; sequences and waits later |
| Startup actions | run on Set load | — | an `onload` alias — later (needs a Set-load event) |
| X-Triggers | clip `[id] …`, locator, MIDI control, Note Trigger Rack | — | direction below |

## Triggers: commands in names

ClyphX's core idea: a name in the Set *is* the program — a clip `[x] mute #drums` runs when it
is launched, a locator when the playhead passes it, a rack pad or chain when a note hits it. It
is the same move as "tags in track names" (0008, later idea). For cmdAbl:

- The Remote Script listens (clip launch, locator passed, note on a pad) and asks the extension
  to run a command line. Today the bridge only goes extension → script, so this needs a
  script → extension channel — a bridge protocol change.
- These commands run while nobody is typing: no dialogs, so no pick list — tags and exact paths
  only; an ambiguous word or `--pick` fails with a logged message.
- Spike after 0.2.0.

## Not adopted

- The ALL-CAPS keyword grammar and the target-before-verb order (`2/MUTE`): cmdAbl keeps
  `verb target`, paths and completion; ClyphX's syntax is made for clip names, not typing.
- MIDI X-Controls: Live's own MIDI mapping and the keymap (0006) cover this.

## Suggested order

1. 0.1.2: `;` action lists together with aliases (0008).
2. 0.1.x: targets `.`, index, range, `all` (cmdabl-core); `vol` / `pan` / `send` and device
   on/off (cmdabl-modules).
3. 0.2.x: snapshots.
4. After 0.2.0: trigger spike (cmdabl-bridge).
