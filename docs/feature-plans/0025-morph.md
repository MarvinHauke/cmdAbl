# Morph: groups of parameters on one master fader

**Status:** Draft (2026-11-11). From the user finding Midi engine-1 (his NerdSEQ/Faderfox UC4 setup, a
ChatGPT concept) and Midi engine-2 (control types in the monitor). Spikes done; pickup still to discuss.

**Parent:** [0018](0018-midi-mapping.md)
**Depends on:** 0018 value mode, [0024](0024-param.md) `param` (parameter addresses and writes), the
Live 13 compatibility check (the spikes run in Live 13).
**Research:** [research/0024-param-and-morph-research.md](research/0024-param-and-morph-research.md)

## The idea (user, 2026-11-11)

- One **master fader** (0…1). Each parameter in a group has a LOW and a HIGH value and a curve; the
  output is `LOW + (HIGH − LOW) · f(x)`, x the master position.
- **LOW and HIGH are set by live knobs** (like the user's NerdSEQ setup). Capture ("take the current
  value as LOW/HIGH") comes later.
- **Several morph groups** (FX, synth, …) can be engaged on the master. Engaging a group momentarily
  on a button is the **punch-in** (`hold` operator from 0018).
- v1: **Live parameters only.** Hardware MIDI out comes later (0018's open question on `send_midi`).

## Decisions (user, 2026-11-11)

1. **Release of a punch-in:** a setting decides; v1 builds only the easier behaviour. Which one is the
   easier is decided in the plan (architect's proposal: snap back to the value before the engage,
   which needs the stored base value per parameter).
2. **One parameter in two engaged groups:** not allowed in v1; nice to have later (then with a rule
   for who wins).
3. **Pickup:** several modes are discussed before the plan is final (see below), together with
   Midi engine-2.
4. **Undo:** don't overdo it. The undo history must not get cluttered; undo for MIDI moves matters
   little. **One to three merged writes per second, or fewer, are enough.** The user's idea: write the
   undo step once a parameter has not changed for a while (a settle time). Spike: does a Python
   `begin_gesture()`/`end_gesture()` pair, ended after a short idle time, give one undo step per
   gesture, the way a mouse drag in Live does?

## Pickup (to discuss)

Live's own Takeover modes are the starting point:

| Mode | What happens when the fader doesn't match the value |
|---|---|
| None (jump) | the value jumps to the fader at once |
| Pick-up | nothing happens until the fader crosses the current value |
| Value scaling | the value moves toward the fader in proportion, meeting it at the end |

More options for cmdAbl: pick-up with a visible "catch" hint on the monitor or the morph page; a
tolerance window around the value. Relative encoders need no pickup.

**Midi engine-2 (user, 2026-11-11):** buttons in `midi monitor` per incoming control to mark its type
(encoder, pot/fader, button). That defines a controller from what it sends, shows its limits (absolute
vs relative, value range) and picks the pickup default per type. The types would live in a controller
profile (0018's open question: global profiles vs per-Set bindings).

**Encoders and trigger lines (user finding, 2026-11-12; to grill with the rest of this section).**
`map learn | jump +1` on a UC4 encoder fired once, then nothing: a bound line fires on a press (0 → >0), and an
absolute encoder keeps sending values > 0 without a 0 in between. The user's idea: keep the previous, last and
current value and read the direction from their order. It works inside 1–126; at the ends (0, 127, or a range
set in the controller) the value repeats and the direction is lost, which is why controllers offer relative
modes (the UC4: e.g. 63/65 or 1/127 per detent). Proposal: a control type **relative encoder** next to button
and pot/fader; a trigger line bound to it runs once per detent, in the direction turned (`jump +1` forward,
the opposite sign backward), and needs no pickup. Open: how a line names its backward action (the sign of
`+N`, or an explicit second line), how the type is set (monitor buttons above, or detected), and other types
(notes as keys, MPE).

## Live 13 spike results (2026-11-11)

[research/live13-spikes.md](research/live13-spikes.md): Python writes from the Remote Script give one
undo step per fader move (plain writes, a gesture, or one undo step around the move) and write 64
parameters in under 1.5 ms; SDK writes cost one undo step per tick and 22–53 ms. **Decision: the morph
engine (MIDI in → compute → write) runs in the Remote Script; setup, storage and pages stay in the
extension.** Decision 4 (undo) is met without a settle timer.

## Spikes (done, kept for the record)

From the research file, the two that decide where the engine runs:
- undo entries for 30 Hz writes through the SDK vs Python (`parameter.value`, with gesture and undo-step
  variants), Cmd+M as the baseline;
- write latency for N = 1…64 parameters per tick.
The rest are listed in the research file.
