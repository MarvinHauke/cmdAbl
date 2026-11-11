# Live 13 spikes — results

Live 13.0.0 (beta), Remote Script 0.1.14 + throwaway `spike` op, branch `spike/live13` (never merged).
Test Set: track 0 "kick2" (Simpler). Measured by cmdabl-architect through MCP; written up by cmdabl-bridge.
Open items are marked **todo**.

## 1. Views (note-2)

`Application.View.available_main_views()` answers: Browser, Arranger, Session, Detail, Detail/Clip,
Detail/DeviceChain. Every other name tried (Help, Info, Lessons, Lesson, Sidebar, SidePanel, Side Panel,
Info View, Help View, Lessons View, Hot-Swap, Properties, Inspector, Search) is refused with a RuntimeError by
`is_view_visible`. The Application has no new view API in Live 13.0.0.
**Result: a side panel, Help View, Info View or Lessons cannot be reached from a Remote Script.**

## 2. Scene data

`Scene` has no `get_data` or `set_data`. `Song` and `Track` have both. Nothing was written.
**Result: scene-level storage is not available; marks must live on the Song (or tracks).**

## 3. Song position and loop

Stopped: `current_song_time` 0, `loop` true, `loop_start` 0, `loop_length` 16, signature 4/4, computed
bar.beat.sixteenth 1.1.1, `Song.get_current_beats_song_time()` "1.1.1.1" (bars.beats.sub_division.ticks, so it
agrees with the computed value).

Playing, loop on: `current_song_time` 15.1717 (beats), `is_playing` true, `loop` true, `loop_start` 0, `loop_length` 16, 4/4,
computed bar.beat.sixteenth "4.4.1", `get_current_beats_song_time()` "4.4.1.42" (the last number is ticks). Our own
conversion matches Live's.

Loop write: changing `loop_start` by one beat **did not create an undo step**. `song.undo()` reverted something else
(the spike redid it and restored the loop; `restored` was true).
**Result: setting the loop from cmdAbl is not undoable with Cmd+Z, and does not add history.**

## 4. Undo at 30 Hz

Parameter used: Simpler "Sample Selector" (0..127, a poor pick: it switches samples). 90 writes in 3 s.
The Python writes ran on `Live.Base.Timer` (exists in Live 13.0.0): median gap 40 ms for a 33 ms interval, p95
41–54 ms, max 118 ms. So the real rate is about 25 Hz, with occasional gaps.

| Variant (Python) | Undo steps to get back to the start value |
| --- | --- |
| a: plain `parameter.value = x` | **1** |
| b: `begin_gesture`/`end_gesture` around each write | **1** |
| b2: one gesture around the whole run | **1** |
| c: `begin_undo_step`/`end_undo_step` around each write | **90** |
| c2: one undo step around the whole run | **1** |
| d: gesture ended 300 ms after the last write | **1** (ended 319 ms after the last write) |

Python writes to a parameter merge into one undo step by themselves; only an explicit undo step per write splits them.

| Variant (SDK) | Undo steps |
| --- | --- |
| a: one bare `setValue` per tick | **90** |
| c: one write per tick, each in its own `withinTransaction` | **90** |
| e: the whole run inside one `withinTransaction` | **90** (see below) |
| p: 8 parameters, bare `setValue` per tick | **90** (tick gaps: median 33.5 ms, max 34.6 ms) |
| b: 8 parameters per tick, each tick one `withinTransaction` | **89** |

Why e gave 90: the SDK commits when the callback has returned; writes started later from timer ticks are outside it.
A transaction can only group writes started synchronously in the callback (or in the promise array it returns at that moment).
**Result: the SDK cannot stream a fader into one undo step; Python can (variants a, b2 or d).** Decision for 0025:
stream through the Remote Script.

## 5. Throughput

Time per tick to write N parameters in one tick.

**SDK** (`Promise.all` of `setValue`, 20 repetitions, 449 parameters available):

| N | plain, median (p95) | in one `withinTransaction`, median |
| --- | --- | --- |
| 1 | 21.2 ms (31) | 21.6 ms |
| 8 | 32.3 ms (34) | 22.2 ms |
| 32 | 42.8 ms (55) | 21.6 ms |
| 64 | 52.6 ms (67) | 21.7 ms |

In a transaction the cost stays near 21 ms whatever N is (p95 about 31–34 ms). Plain writes grow with N.
Every SDK tick costs at least about 20 ms.

**Python** (385 parameters available), median per batch:

| N | direct in the request handler | from `Live.Base.Timer` |
| --- | --- | --- |
| 1 | 0.003 ms | 0.04 ms |
| 8 | 0.21 ms | 0.41 ms |
| 32 | 0.34 ms | 0.62 ms |
| 64 | 0.48 ms (max 0.66) | 0.43 ms (p95 up to 1.49) |

Timer tick gaps for a 33 ms interval: median 40 ms, p95 51 ms, max 70 ms.
After this run, `undo_count` needed 89 undo steps: the run wrote many different parameters in turn, so that count is expected.

## Conclusion

Morph writes belong in the Remote Script. A move of 64 parameters takes under 1.5 ms there and gives one undo step
(plain writes merge by themselves). From the SDK every tick is its own undo step (90 or 89 for a 3 s move,
whether bare or in a transaction per tick) and costs 20 ms or more, which is most of a 30 Hz budget.
