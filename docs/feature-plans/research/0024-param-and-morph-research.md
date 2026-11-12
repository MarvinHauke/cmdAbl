# Research for 0024 `param` and 0025 morph

**Date:** 2026-11-11. Research only: nothing here was run in Live. Each claim is marked
**[source]** (read in a file or on a page named next to it) or **[spike]** (must be measured in Live).

Sources used: `docs/sdk-tree.md`, the SDK build in `node_modules/@ableton-extensions/sdk/dist/`
(`index.d.mts`, `index.mjs`, version 1.0.0-beta.1, API 1.0.0), `remote-script/cmdAbl/`, `src/`, the
Cycling '74 LOM reference, the unofficial Live Python API reference (generated from Live 11.0.0, the
newest one published), the LiveFader repository, forum threads, and the Live 13 beta release notes.

## Summary

**What is possible**

- `param` can be built on the SDK alone. Every device parameter is reachable
  (`track.devices[].parameters[]`, racks through `chains[].devices[]`, mixers through `mixer`), with
  name, min, max, quantized flag, default value and value items, an async read and an async write.
- A command that writes N parameters inside one `withinTransaction` is one undo step. `vol` already
  works this way.
- The Remote Script can do everything the SDK lacks: display text (`str_for_value`), value listeners,
  automation state, enabled state, the parameter the user last touched (`Song.View.selected_parameter`),
  and writes straight from `receive_midi` with no round trip.

**What blocks or is open**

1. **Undo is the main risk for morph.** The SDK has no write without an undo step: `setValue` opens
   its own transaction for every call **[source]**. A fader at 30 Hz would create 30 undo steps a
   second (one per tick if each tick is wrapped in one transaction), unless Live merges them. Whether
   Live merges, and whether a Python `parameter.value = x` creates undo steps at all, is not documented
   anywhere I found. **[spike 1 and 2]**. This decides the design.
2. **The SDK has no listeners at all.** Nothing can be observed. Keeping values in sync, pickup, and
   "set LOW with a knob" need either polling `getValue()` or the Remote Script's `add_value_listener`
   plus the existing UDP push.
3. **No stable parameter identity.** SDK handles and LOM ids live for one session. A stored morph
   group has to be re-resolved by path and parameter name after a Set reload (LiveFader does the same,
   by LOM path, and breaks when devices move).
4. **The bridge request path is too slow for continuous writes.** The script reads requests only in
   `update_display` (about 10 Hz, 32 datagrams per tick) **[source]**. Extension → script → write
   cannot carry a 30 Hz fader as it is.
5. **Completion of parameter names per device is not possible today.** A completer runs once when the
   palette opens and gets no tokens **[source]**, so it cannot know which device was typed.

**Recommended split**

| Piece | Where | Why |
|---|---|---|
| `param` read and write (0024) | Extension, SDK only | One command, one transaction, one undo step. Works without the Remote Script, like `vol`. |
| `param` display text, units, enabled and automation state | Remote Script, optional | The SDK has none of these. Extend `param_display` from "track volume" to any route + parameter. Fails soft without the script. |
| Morph configuration: groups, members, curves, storage, pages (0025) | Extension | Commands, undo of edits, files, dialogs live here. |
| Morph engine: fader in → compute → write N parameters | **Remote Script, if spike 2 shows Python writes are no worse for undo than SDK writes** | MIDI arrives there; no round trip; value listeners and `selected_parameter` are there; it keeps working when the Extension Host restarts. The extension sends the compiled group table over the bridge. |
| Morph engine, fallback | Extension, one `withinTransaction` per tick | Only if spike 1 shows Live merges the steps or the user accepts the undo history, and spike 3 shows the latency is fine. Simpler: no new script protocol. |

If both write paths flood the undo history, morph still works but Cmd+Z becomes useless while it is
in use. The plan should then say so plainly and offer "restore group to LOW/HIGH/values before
engage" as the replacement, which Octatrack-style tools do anyway.

## 1. SDK: parameters, writes, undo, listeners, identity

**How parameters are reached [source]**

- `Device.parameters: DeviceParameter[]` (`index.d.mts:460-464`).
- Nested: `RackDevice.chains: Chain[]` (`index.d.mts:946-951`), `Chain.devices: Device[]` and
  `Chain.mixer: ChainMixer` with `volume`, `panning`, `sends[]` (`index.d.mts:915-934`, class
  `ChainMixerDevice` at `:906-907`). `DrumRack.chains` are `DrumChain` (`:955-958`).
- Track mixer: `Track.mixer.volume | panning | sends[]`, all `DeviceParameter` (`index.d.mts:493-498`).
- Tree overview: `docs/sdk-tree.md:57-65` (device parameters), `:66-80` (racks and chains), `:88-91`
  (track mixer).

**Fields [source: `index.d.mts:446-456`]**

| SDK | LOM equivalent | Notes |
|---|---|---|
| `name` (r) | `name` | The only name. No `original_name`. |
| `min`, `max` (r) | `min`, `max` | Raw names in the host API are `deviceParameterGetInternalMin/Max` (`:228-229`): internal values, not display values. |
| `isQuantized` (r) | `is_quantized` | |
| `defaultValue` (r) | `default_value` | LOM: "only available for non-quantized parameters". What the SDK returns for a quantized one is unknown **[spike 6]**. |
| `valueItems` (r) | `value_items` | `{ name, shortName }[]` (`docs/sdk-tree.md:246-249`). The Python API raises for non-quantized parameters; SDK behaviour unknown **[spike 6]**. |
| `getValue(): Promise<number>` | `value` | Async read (`deviceParameterGetInternalValue`, `:233`). |
| `setValue(v): Promise<void>` | `value` | Async write, rejects with the host's error text (`:234`). |

**Missing in the SDK [source: the whole `DeviceParameter` class is the ten lines above]**

- No display string (`str_for_value`, `display_value`).
- No automation state, no `re_enable_automation`.
- No `is_enabled` / `state` (macro-mapped or Max-controlled parameters cannot be written; the SDK
  cannot tell beforehand, the write presumably rejects **[spike 6]**).
- No listener, observer or event of any kind. A search of `index.d.mts` for "observe", "listener",
  "subscribe" and `on…(` finds only the one-shot `onResult`/`onError` callbacks of async calls.
- `Device` has only `name` and `parameters`: no class name, no on/off property (the on/off switch is
  normally parameter 0, "Device On", by LOM convention), no `type`.
- `Chain` has no name (cmdAbl already gets chain names from the script: `src/ableton/objectTree.ts:157-180`).
- No MIDI in or out (`docs/feature-plans/0018-midi-mapping.md:31`).

**Writes and undo [source]**

- `setValue` wraps itself in a transaction. `node_modules/@ableton-extensions/sdk/dist/index.mjs:212-218`:

  ```js
  setValue(value) {
    return new Promise((resolve, reject) => {
      this.dataModel.withinTransaction(() => {
        this.dataModel.deviceParameterSetInternalValue(this.handle, value, resolve, (error) => reject(new Error(error)));
      });
    });
  }
  ```

- `withinTransaction` doc (`index.d.mts:870-886`): "Individual mutations are already undoable on their
  own; use this only to roll several changes into one user-facing undo entry. Nested transactions
  collapse into the outermost one." The callback must be synchronous but may return `Promise.all([...])`.
- So: a bare `setValue` is one undo step; N `setValue` calls started inside one outer
  `withinTransaction` are one undo step. `vol` does exactly this: `src/modules/vol/index.ts:119`, wired
  at `src/extension.ts:283-289`, write helper `src/core/host/volume.ts:29-39`.
- **There is no API to write without an undo step**, and none to merge transactions across calls.
  The only tool is "more writes per transaction".
- **[spike 1]** Does Live merge successive transactions on the same parameter into one history entry
  (as it does for a mouse drag)? Not documented.

**Listeners [source]:** none (see above). Options: poll `getValue()` (cost unknown, **[spike 4]**), or
the script's `add_value_listener` plus the UDP push that already exists
(`remote-script/cmdAbl/events.py`).

**Identity [source]**

- `Handle` is `{ id: bigint }`, "an arbitrary number assigned by the host" (`index.d.mts:7-24`).
  Objects are cached by handle id; `getObjectFromHandle` throws when the object was deleted or has
  another type (`index.d.mts:862-868`).
- cmdAbl already treats handles as temporary: "handles aren't permanent" (`src/ableton/objectTree.ts:30`),
  and path ordinals are "not a stable identity" (`:182-188`).
- Nothing in the SDK or the LOM survives a Set reload. **[spike 7]** checks what a handle does within a
  session: after a rename, a reorder, moving the device to another track, undo/redo of a delete.
- Consequence: store `{ device path, parameter name, ordinal among same-named parameters, last known
  index }`, resolve to a handle when a group is loaded or engaged, and re-resolve when a write rejects.

## 2. Remote Script / LOM

**DeviceParameter in the LOM [source: https://docs.cycling74.com/apiref/lom/deviceparameter/]**

| Member | Access | Meaning |
|---|---|---|
| `value` | get, set, observe | Internal value between `min` and `max`. |
| `display_value` | get, set, observe | The value as the GUI shows it. Not in the Live 11 Python reference; newer **[spike 6]**. |
| `min`, `max`, `default_value`, `is_quantized`, `value_items`, `name`, `original_name` | get | `default_value` only for non-quantized, `value_items` only for quantized. `MidiPitch.Pitch`-style parameters look stepped but report `is_quantized` 0. |
| `automation_state` | get, observe | 0 none, 1 active, 2 overridden. |
| `state` | get, observe | 0 active, 1 changeable but without effect, 2 cannot be changed. |
| `is_enabled` | get | False when macro-controlled, controlled by `live.remote~`, or otherwise locked by Live. |
| `str_for_value(value)` | function | Display text for any value, without moving the parameter. cmdAbl uses it already: `remote-script/cmdAbl/ops/params.py:57-61`. |
| `re_enable_automation()` | function | Per parameter. `Song.re_enable_automation()` does it for all (LOM `song` page). |

**Only in the Python API [source: unofficial reference, https://nsuspray.github.io/Live_API_Doc/11.0.0.xml]**

- `DeviceParameter.begin_gesture()` / `end_gesture()`: "Notify the begin of a modification of the
  parameter, when a sequence of modifications have to be consider a consistent group — for example,
  when recording automation." This is the documented way to group a continuous move for automation
  recording. Whether it also groups the undo steps is not stated **[spike 2]**.
- `Song.begin_undo_step()` / `end_undo_step()`: listed, no description. Not on the LOM `song` page,
  which has only `undo`, `redo`, `can_undo`, `can_redo`
  (https://docs.cycling74.com/apiref/lom/song/). cmdAbl already calls them, guarded:
  `remote-script/cmdAbl/ops/chains.py:193-216`, `ops/tags.py:114-115`; plan 0001 notes one invisible
  "Custom Action" step from such a pair (`docs/feature-plans/0001-path-addressed-objects-and-commands.md:636-637`).
- `Song.View.selected_parameter`: "Get the currently selected device parameter" (the one the user last
  clicked). This is how LiveFader learns parameters.
- `Song.set_data` / `get_data`: persistent with the Set. cmdAbl's spike found `Track.set_data` adds no
  undo step and does not mark the Set modified (`remote-script/cmdAbl/ops/tags.py:3-8`).
- `Live.Base.Timer`: "A timer that will trigger a callback after a certain interval. The timer can be
  repeated." A main-thread timer faster than `update_display` **[spike 5]**.
- `Live.MidiMap.map_midi_cc(handle, parameter, channel, cc, map_mode, avoid_takeover[, sensitivity])`:
  Live's own mapping of a CC to one parameter, including takeover. Useful for a plain 1:1 `map … | param`
  binding later; no use for morph (no per-parameter LOW/HIGH or curve).
- `forward_midi_cc(…, ShouldConsumeEvent=True)`: an optional flag exists; with `False` a forwarded CC
  may also stay available to Live **[spike, low priority]**.

**Undo behaviour of `parameter.value = x` from Python: not documented. [spike 2]** What I found:

- The LOM `deviceparameter` and `song` pages say nothing about undo.
- Max for Live, which uses the same object model: `live.object` writes go to the undo history on every
  change; `live.remote~` creates none but disables the parameter in Live and bypasses its automation
  ("A parameter is disabled in Live while it is controlled by a live.remote~ … Additionally, no undo
  steps are created", https://docs.cycling74.com/reference/live.remote~). Forum:
  https://cycling74.com/forums/parameter-modulation-without-adding-to-undo-history ("there's been a
  number of requests … to allow updates via live.object to not store undo history … so far this is not
  possible"). A poster there quotes Live 12.1.5b2 notes: "only changed parameters get added to undo"
  (secondhand).
- `live.remote~` has no Python or SDK equivalent that I could find.
- Whether moving a Cmd+M-mapped control fills the undo history: forum posts disagree and none is
  authoritative (https://cycling74.com/forums/clogged-undo-history-in-live-due-to-randomization-controls).
  Measure it, because it is the baseline users compare against **[spike 2]**.

**How the existing script handles MIDI and requests [source]**

- `receive_midi` (`remote-script/cmdAbl/cmdabl.py:94-107`) parses the message and pushes it to the
  extension at once as a UDP datagram (`events.py:42-44`). Measured in the 0018 spike: median
  0.2–0.5 ms, max 2 ms; a bound command runs 75–110 ms after the press
  (`docs/feature-plans/0018-midi-mapping.md:133-137`). That 75–110 ms is a full headless command run
  (parse, tree, resolve), not a bare SDK write.
- Only listened controls are forwarded (`midi.py:210-240`); a control mapped with Cmd+M is not
  forwarded at all (`0018:144-147`).
- Requests from the extension are read in `update_display` only (`cmdabl.py:65-67`, `:126-140`), at
  most `MAX_PER_TICK = 32` per tick (`:31`), replies capped at 4096 bytes (`protocol.py:18`).
  `update_display` is called by Live about every 100 ms.
- Routes are index lists: track, device, chain, device, … (`routes.py:66-80`), the same shape as
  `ObjectNode.route` (`src/ableton/objectTree.ts:20-23`, `src/ableton/lomPath.ts:24-33`). A parameter
  needs one more step: an index into `device.parameters`, or `mixer_device.volume` and friends.
- Writing ops need the access token and `expectName` (`ops/__init__.py:6-8`, `:33`).

**Where should morph writes happen?**

| | In the Remote Script | In the extension |
|---|---|---|
| Path | MIDI in → `receive_midi` → compute → `param.value = x` | MIDI in → UDP push → compute → `setValue` × N in one transaction |
| Latency | No hop. Writing the LOM from `receive_midi` is what framework scripts do (their control listeners run inside it). | 0.2–0.5 ms push **[source]** + SDK write time **[spike 3]**. |
| Undo | Unknown **[spike 2]**. `begin_gesture`/`end_gesture` and `begin_undo_step` are available to try. | One step per transaction, certain **[source]**; merging unknown **[spike 1]**. |
| Feedback | `add_value_listener` on every member: knows when the user or automation moved a parameter (pickup, capture LOW/HIGH, "last user value"). | Polling only. |
| Automation | Can read `automation_state`, call `re_enable_automation`. | Blind. |
| Works while the Extension Host restarts | Yes, with the last table it was given. | No. |
| Cost | A new stateful engine in Python (table op, chunking under 4 KB, stale-route handling, tests with fakes), protocol version bump. | A tick loop and a table in TypeScript; reuses `api.tracks.transaction`. |
| Stale addresses | Hold LOM object references after resolving once; they stay valid when indices shift. Drop a member when its object dies. | Hold SDK handles; same idea. |

Rate limiting belongs in whichever side writes: keep the newest fader value and write on a ~33 ms
tick, and write a parameter only when its computed value changed. In the script the tick is
`Live.Base.Timer` **[spike 5]** or "write directly in `receive_midi`, at most once per 33 ms, and flush
the last value from `update_display`" (the pattern `midi.py:182-206` already uses for the status bar).

## 3. Addressing in cmdAbl today, and a parameter address on top

**Today [source]**

- The tree has three node kinds: `track`, `device`, `chain` (`src/ableton/objectTree.ts:28`). Devices
  inside chains and nested racks are included (`:141-180`); chains appear only when the script has
  delivered their names.
- A node has a display `path` (`/Lead/Wavetable`, same-named siblings get `#2`, `:189-197`) and a
  `route` of indices for re-resolving (`:30-36`).
- `resolvePath` (`src/ableton/resolvePath.ts:51-59`): exact segments, then ignoring case, then
  substring of the whole path; `Kick#2` picks the second. Zero matches is "not found", several is
  "ambiguous", and the platform asks (`src/core/command/resolveArgs.ts:86`, `:222`).
- A command declares `kind: "path"` with `kinds: [...]` (`src/core/command/commandTree.ts:15-48`);
  `#tag` fans out to every tagged track for every path argument.
- `vol`: one text argument (dB) and a variadic path argument, tracks only
  (`src/modules/vol/index.ts:48-51`, `:60-62`); reads all, plans, writes all in one transaction (`:67`,
  `:119`), logs old → new with an undo line (`:126-129`).
- The module API exposes tracks only: `api.tracks.volume / setVolume / transaction / track`
  (`src/modules/types.ts:38-63`, `src/extension.ts:281-293`). `trackFor` resolves by `route[0]`
  (`src/ableton/trackLookup.ts`). There is no device or parameter port yet.

**A parameter address**

The form from plan 0018 works with the existing resolver and needs no new path syntax:

```
param <device path> <parameter name> [<value>]
param /Lead/Wavetable "filter 1 freq" 50%
```

- Argument 1 is a normal path (`kinds: ["device", "track", "chain"]`). A track or chain target means
  its mixer: `volume`, `pan`, `send A`.
- Argument 2 is matched inside the resolved device with the same three rules as paths (exact, ignoring
  case, substring) and the same `#2` ordinal for duplicate names (rack macros, plug-ins). Zero is exit
  3, several is exit 4 with the platform's pick list.
- For storage and for `map` lines a one-token form is handy: `/Lead/Wavetable:Filter 1 Freq`. Decide
  in the plan; `:` would be new reserved syntax, the two-argument form is not.
- Needed in core (`src/modules/types.ts` is core's file): a port such as
  `api.params.list(node)`, `.read(ref)`, `.write(ref, value)` next to `api.tracks`, walking
  `route` through `devices` and `chains` in the SDK the way `routes.py:66-80` does in Python.
- **Completion gap:** a completer is called once at palette open without tokens
  (`src/modules/types.ts:196-204`), so it cannot offer "the parameters of the device typed in argument
  1". Options: a snapshot of every device's parameter names at open (size and time unknown,
  **[spike 4]**), or the token-aware completion that plan 0006 leaves for later.
- A whole-Set parameter index is large: one Wavetable has roughly 90 parameters. Build it per device on
  demand, not in `buildObjectTree`.

**Is `vol` / the dB helper reusable?**

| Piece | Reusable for `param`? |
|---|---|
| `src/modules/shared/relative.ts` `applyRelative` (`:33`): a relative step on a group with `stop` / `clip` | Yes, as is. It works on plain numbers and bounds. |
| The read-all, plan, write-all-in-one-transaction shape of `vol` (`index.ts:67-131`) and its log lines | Yes, as the pattern. |
| `src/modules/shared/mixValue.ts` `valueToDb` / `dbToValue` | Only for track volume. It is a table of Live's fader curve measured in Live (`mixTable.ts`, 1001 points). Other parameters have other curves. Check chain volume and sends before reusing it there **[spike 6]**. |
| `src/core/host/curve.ts` + `param_display` (`ops/params.py`) | The method generalises: sample `str_for_value` over min..max and invert by binary search to accept display units (`param … 2.5kHz`). Needs `param_display` opened to any route and parameter (today `_param` allows only `"volume"`, `ops/params.py:20-24`). |
| `src/modules/vol/plan.ts` `parseDb`, `formatDb` | dB only. `param` needs its own parser: raw, `50%`, `+5%`, `-10`, item name or index for quantized. |

Value scaling for v1 without the script: percent is linear in the internal value,
`min + p × (max − min)`. That is what Live's own MIDI mapping does (plan 0018, "Resolution for
volume"), so it is honest but not perceptual for frequency-like parameters. Quantized parameters: step
by item, accept item names from `valueItems`.

## 4. Prior art

| Tool | Finds and references parameters | Writes | Stores | Limits |
|---|---|---|---|---|
| **LiveFader** (tomduncalf, Max for Live, TypeScript, last commit 2021-05-20, work in progress) | Learn by touch: observes `live_set view selected_parameter` and that parameter's `value`; ignores its own device | `LiveAPI.set("value")` from a 30 fps task, only when the fader moved; linear lerp of the internal value | 8 scenes A–H, one per fader side; JSON in a `pattr`: `{ path, lockedValue }` with index-based LOM paths | See below |
| **Scene Fader** (chapelier fou, maxforlive.com id 6850, 2021) | Built on the "map8" mapping device | Not readable | Not readable | A user asked for a way to release mapped parameters (forum thread) |
| **Parameter Morpher** (midrun, maxforlive.com id 13368, Gumroad) | One target device; morph switched on per parameter | One dial 0–100 % between A and B | Two snapshots A and B of that device, editable in a table | One device per instance; details not readable |
| **PushScenes** (averpe, maxforlive.com id 14870, v1.0) | Captures scenes of parameter, clip, mute and mix states | Morphs between 4 snapshots on Push 3's XY pad; quantised transitions | Scenes captured from the pad matrix | Author calls it work in progress (Elektronauts) |
| **MK Crossfader** | Not found under that name in any search. Ask the user for a link. | | | |
| **Live 13 racks** (native) | Macro mapping | One macro drives many parameters, each with min/max; 13.0b25 adds a breakpoint curve per macro, up to 32 macros, and macros as modulators | In the rack | One rack only; min/max are edited in map mode, not by knobs while playing |

maxforlive.com answered 403 to every fetch, so those three rows come from search snippets, the forum
thread https://forum.ableton.com/viewtopic.php?p=1785610 and
https://midrun.gumroad.com/l/parameter_morpher. Treat them as leads, not facts.

**LiveFader in detail [source: https://github.com/tomduncalf/livefader, commit `1e433f2`]**

- **Discovery** (`src/LiveParameterListener.ts`): a chain of `LiveAPI` observers, selected track →
  selected device → `live_set view selected_parameter` → that parameter's `value`. The user presses the
  left or right button ("mapping mode"), moves any parameter in Live, and it is locked to that side at
  the value it was moved to (`src/LiveFader.ts:204-235`). The same idea is available to cmdAbl through
  `Song.View.selected_parameter` in the Remote Script.
- **State machine** (`LiveFader.ts:36-40`): Normal, Mapping, Crossfading. While it writes, it is in
  Crossfading and ignores value callbacks, so its own writes are not taken for user moves (`:148-168`,
  `:232-234`). cmdAbl's engine needs the same guard once it listens to values.
- **One-sided locks:** a parameter locked on one side only fades between the lock and the "last user
  value", tracked while in Normal state (`:152-160`, `:205-212`). This is the Octatrack behaviour, and
  it is the reason listeners are needed.
- **Leaving a scene:** parameters no longer in either active scene are reset to their last user value
  (`:292-300`).
- **Writes:** fader input only stores the value; a `Task` at `1000 / 30` ms applies it when it changed
  ("Handle crossfader input at 30fps rather than continuously to help with performance", `:85-88`,
  `:139-146`). Each parameter: `lerp(a, b, fader)` then `apiObject.set("value", …)`
  (`src/lib_maxForLiveUtils.ts:68-72`).
- **Undo:** not handled. It writes through the `LiveAPI` object, the path that fills the undo history
  according to the Max documentation and forums (section 2). The README does not mention undo.
- **Storage** (`src/models.ts:9-18`, `:33-46`, `LiveFader.ts:353-391`): scenes as JSON in a `pattr`,
  each lock as an LOM path string plus value; ids are looked up again on load ("We need to rediscover
  each locked parameter's id on loading state as it could have changed"). Index paths break when a
  track or device is inserted before the target.
- **Limits read from the code and README:** device lookup by the regex `live_set tracks N devices M`
  (`lib_maxForLiveUtils.ts:46`, `:77`), so return tracks, the main track and devices in racks are not
  handled properly; no curve; no handling of quantized parameters; no way to remove one lock, only
  "reset scene"; some controls do not register as the selected parameter (the README names
  Wavetable's visual display); one instance per Set.

**What to take over**

- Learn by touching a parameter in Live, via `selected_parameter` (script side).
- A write tick of about 30 Hz, write only on change.
- An explicit "engine is writing" state so own writes are not read back as user moves.
- "Last user value" as the implicit other end, restored when a group is released (fits momentary
  engage / punch-in).
- Do not store index paths alone: store cmdAbl path + parameter name and re-resolve.
- Quantized parameters switch at a threshold instead of interpolating (Octatrack does this for binary
  parameters, https://www.elektronauts.com/t/scenes-with-no-interpolation/186668/15).

## 5. Live 13 beta release notes

Source: https://www.ableton.com/en/release-notes/live-13-beta/, read 2026-11-11 through a summarising
fetch. The page showed one version, **13.0b25 (2026-11-10)**; earlier betas were not on it. Re-read by
hand before relying on any single item.

Relevant items:

- **Macros:** "Each Macro Control in a Rack now has an individual breakpoint curve"; "Up to 32 Macro
  Controls can now be created in a Rack"; "Macro Controls can now also work as modulators"; "Max for
  Live parameters do not work with a modulator Macro Control"; "It is no longer possible to macro-map a
  parameter that is already being remote-controlled by Max for Live." Native racks now cover a good part
  of "one control, many parameters, min/max, curve". Morph's own ground is: parameters anywhere in the
  Set, LOW/HIGH set by knobs while playing, several groups on one fader, momentary engage.
- **Undo:** XY controls: "A single dragging action is now one undo step." This shows Live's own UI
  merges a gesture into one step; it says nothing about API writes.
- **Automation:** "You can now capture automation as well as MIDI notes using the Capture button".
  Parameter moves made by morph may then be capturable; `begin_gesture`/`end_gesture` could matter
  **[spike 2]**.
- **Max for Live:** "parameter: fixed crash on undo of an unautomatable parameter change in Live".
- **Nothing** about the Extensions SDK, the Extension Host, Remote Scripts, Python or the Live API was
  in the notes read. SDK compatibility with Live 13 is the separate check already planned in
  `docs/feature-plans/STATUS.md`. The SDK page https://ableton.github.io/extensions-sdk still names
  Live 12.4.5 and has no changelog.

## Spikes to run in Live

Run in a test Set with one track "Lead" holding Wavetable, an Instrument Rack with a nested rack, and
one third-party plug-in. Open Edit → Undo History for every undo measurement (Live 12.4.16 and 13.0b25,
both if possible).

1. **SDK writes and undo.**
   - a. 1 parameter, 300 bare `setValue` calls at 30 Hz for 10 s. Record: number of undo history
     entries, their label, how many Cmd+Z presses return to the start value.
   - b. 8 parameters, each tick wrapped in one `withinTransaction`, 30 Hz for 10 s. Same numbers. Expected
     300 entries unless Live merges.
   - c. Same as b at 10 Hz and at 60 Hz, to see whether merging depends on the gap between writes.
   - d. Does Live stay responsive, and does the history have a cap (what is dropped)?
2. **Python writes and undo** (temporary op or a scratch script).
   - a. `param.value = x` on 1 parameter, 300 writes from `receive_midi`. Count undo entries.
   - b. The same between `param.begin_gesture()` and `param.end_gesture()`.
   - c. The same between `song.begin_undo_step()` and `song.end_undo_step()`, with the pair held open
     across ticks (open on first move, close 500 ms after the last).
   - d. Baseline: the same knob mapped with Cmd+M, 10 s of movement. Count undo entries.
   - e. Baseline: `Live.MidiMap.map_midi_cc` to the parameter. Count undo entries.
   - f. While arrangement or session automation recording is on: do a–c record automation, and as one
     gesture?
   - g. A parameter with automation: after a write, read `automation_state` (expect 2), then
     `re_enable_automation()`.
3. **Latency, extension path.** Timestamp in `receive_midi` (`t` is already in the event) → time the
   `Promise.all` of N `setValue` resolves, for N = 1, 8, 32, 64. Record median, p95 and max over 300
   fader messages, and Live's CPU meter. Target: p95 under 30 ms for N = 32.
4. **SDK read cost.** `getValue()` on 1, 32 and 200 parameters in one `Promise.all`: median and max
   time. Time to read `name` for every parameter of every device in the Set (count them), to judge a
   completion snapshot and polling at 5–10 Hz.
5. **Script write rate.** Write N = 8, 32, 64 parameters per message directly in `receive_midi` while
   sweeping a fader fast: time per batch, dropped or late MIDI, audio dropouts. Then the same from a
   `Live.Base.Timer` at 33 ms: does the timer exist in this Live version, what is its real interval and
   jitter, does it run on the main thread (LOM writes succeed)? Also measure the real `update_display`
   interval.
6. **Field behaviour.**
   - SDK `defaultValue` and `valueItems` on a quantized and on a non-quantized parameter (value or
     throw?).
   - SDK `setValue` outside min..max, on a macro-mapped parameter (`is_enabled` false), on a parameter
     controlled by a Max device, and on a device inside a switched-off rack: reject text or silent?
   - Do SDK `min`/`max`/`getValue` equal the LOM's `min`/`max`/`value` for the same parameter (Wavetable
     Filter 1 Freq, a plug-in parameter, a rack macro, track pan, a send)?
   - Does `display_value` exist in the Python API of this Live version?
   - Is the track-volume table (`mixTable.ts`) also right for chain volume? What curve do sends have?
   - Parameter names: duplicates inside one device (rack macros, the plug-in), and whether `name`
     changes when a macro is renamed.
7. **Handle lifetime (SDK) and reference lifetime (Python).** Keep a parameter handle / object, then:
   rename the device, reorder devices, move the device to another track, group it into a rack, delete
   and undo, save and reopen the Set. After each: does `getValue()` / `.value` still work, and is the
   handle id the same when the tree is rebuilt?
8. **Listeners (Python).** `add_value_listener` on 64 parameters: callback rate while a mapped knob
   sweeps one of them, cost of pushing each change over UDP, and whether a write made by the script
   itself fires the listener (needed for the "engine is writing" guard). `Song.View.selected_parameter`:
   does it change when the user turns a knob, or only on click? Which controls never register?
9. **Bridge capacity for a morph table.** One group of 64 members as `{route, param index, expectName,
   low, high, curve}`: bytes per member, chunks needed under the 4 KB cap, total time to load through
   the 10 Hz `update_display` drain.
