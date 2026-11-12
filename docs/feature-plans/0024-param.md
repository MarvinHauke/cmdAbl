# `param`: read and set Live device parameters by name

**Status:** Draft (2026-11-11). From the user finding Midi engine-1: parameters come from their own
module, so other modules ([0025](0025-morph.md) morph), `;` chains and `map` bindings can use them.

**Parent:** [0018](0018-midi-mapping.md) (its "instrument parameters by name" building block, Live half)
**Depends on:** 0018 value mode for `map … | param … {}`; the command itself works without it.
**Research:** [research/0024-param-and-morph-research.md](research/0024-param-and-morph-research.md)

## Decisions (user, 2026-11-11)

- **v1: Live parameters only** (devices, rack chains, mixer). Hardware parameters through the MIDI Guide
  data stay in 0018 for later.
- **A separate module**, usable in the palette, in `;` chains and as a value-mode target.

## Sketch (to be decided)

```
param /Lead/Wavetable "filter 1 freq"          # show the value
param /Lead/Wavetable "filter 1 freq" 50%      # set
param /Lead/Wavetable "filter 1 freq" +5%      # relative
```

- The address is the existing device path plus a parameter name, with `#2` for a second parameter of the
  same name.
- From the research: the SDK gives name, min, max, default, value items, read and write; no display text
  ("1.2 kHz"), no automation state, no change listener. Writes are one undo step per command (one
  transaction), as in `vol`.
- Needs a new core port (`api.params`): modules reach tracks only today. That is a `ModuleApi` change
  and goes to the user before it is built.
- Parameter-name completion per device isn't possible with today's completion (completers run once at
  palette open).

## Open questions

- Value forms: percent, raw, the parameter's own unit (needs the display text from the Remote Script)?
- Which parameters are listed when no name is given: a pick list?
- Completion of parameter names: wait for 0006 step 3, or a narrower completer?
