# Ableton Extensions SDK — complete reference

Generated from `node_modules/@ableton-extensions/sdk/dist/index.d.mts` (API version 1.0.0).

---

## 1. context object tree

```
context
├── .application                          Application
│   └── .song                             Song
│       ├── .tempo                        number (r/w)
│       ├── .gridQuantization             GridQuantization (r)
│       ├── .gridIsTriplet                boolean (r)
│       ├── .rootNote                     number (r)  — MIDI 0–11
│       ├── .scaleName                    string (r)
│       ├── .scaleMode                    boolean (r)
│       ├── .scaleIntervals               number[] (r)
│       ├── .tracks[]                     Track[]  — regular tracks only
│       │   ├── .name                     string (r/w)
│       │   ├── .mute                     boolean (r/w)
│       │   ├── .solo                     boolean (r/w)
│       │   ├── .mutedViaSolo             boolean (r)
│       │   ├── .arm                      boolean (r/w)
│       │   ├── .groupTrack               Track | null (r)
│       │   ├── .clipSlots[]              ClipSlot[]
│       │   │   ├── .clip                 Clip | null (r)
│       │   │   ├── .createMidiClip()     → Promise<MidiClip>
│       │   │   ├── .createAudioClip()    → Promise<AudioClip>
│       │   │   └── .deleteClip()         → Promise<void>
│       │   ├── .takeLanes[]              TakeLane[]
│       │   │   ├── .name                 string (r/w)
│       │   │   ├── .clips[]              Clip[]
│       │   │   ├── .createMidiClip()     → Promise<MidiClip>
│       │   │   └── .createAudioClip()    → Promise<AudioClip>
│       │   ├── .arrangementClips[]       Clip[]
│       │   │   ├── .name                 string (r/w)
│       │   │   ├── .startTime            number (r)
│       │   │   ├── .endTime              number (r)
│       │   │   ├── .duration             number (r)
│       │   │   ├── .startMarker          number (r)
│       │   │   ├── .endMarker            number (r)
│       │   │   ├── .looping              boolean (r/w)
│       │   │   ├── .loopStart            number (r)
│       │   │   ├── .loopEnd              number (r)
│       │   │   ├── .color                number (r/w)
│       │   │   └── .muted                boolean (r/w)
│       │   │   ── AudioClip extends Clip
│       │   │       ├── .filePath         string (r)
│       │   │       ├── .warping          boolean (r/w)
│       │   │       ├── .warpMode         WarpMode (r/w)
│       │   │       └── .warpMarkers      WarpMarker[] (r)
│       │   │   ── MidiClip extends Clip
│       │   │       └── .notes            NoteDescription[] (r/w)
│       │   ├── .devices[]                Device[]
│       │   │   ├── .name                 string (r)
│       │   │   └── .parameters[]         DeviceParameter[]
│       │   │       ├── .name             string (r)
│       │   │       ├── .min / .max       number (r)
│       │   │       ├── .isQuantized      boolean (r)
│       │   │       ├── .defaultValue     number (r)
│       │   │       ├── .valueItems       DeviceParameterValueItem[] (r)
│       │   │       ├── .getValue()       → Promise<number>
│       │   │       └── .setValue()       → Promise<void>
│       │   │   ── RackDevice extends Device
│       │   │       ├── .chains[]         Chain[]
│       │   │       │   ├── .devices[]    Device[]  (same shape as above)
│       │   │       │   ├── .mixer        ChainMixer
│       │   │       │   │   ├── .volume   DeviceParameter
│       │   │       │   │   ├── .panning  DeviceParameter
│       │   │       │   │   └── .sends[]  DeviceParameter[]
│       │   │       │   ├── .insertDevice()    → Promise<Device>
│       │   │       │   ├── .deleteDevice()    → Promise<void>
│       │   │       │   └── .duplicateDevice() → Promise<Device>
│       │   │       └── .insertChain()    → Promise<Chain>
│       │   │   ── DrumRack extends RackDevice
│       │   │       └── .chains[]         DrumChain[]
│       │   │           ├── .receivingNote  number (r/w)  — MIDI note
│       │   │           └── (inherits Chain)
│       │   │   ── Simpler extends Device
│       │   │       ├── .sample           Sample | null (r)
│       │   │       │   └── .filePath     string (r)
│       │   │       └── .replaceSample()  → Promise<Sample>
│       │   ├── .mixer                    TrackMixer
│       │   │   ├── .volume               DeviceParameter
│       │   │   ├── .panning              DeviceParameter
│       │   │   └── .sends[]              DeviceParameter[]
│       │   ├── .createTakeLane()         → Promise<TakeLane>
│       │   ├── .insertDevice()           → Promise<Device>
│       │   ├── .deleteDevice()           → Promise<void>
│       │   ├── .duplicateDevice()        → Promise<Device>
│       │   ├── .deleteClip()             → Promise<void>
│       │   └── .clearClipsInRange()      → Promise<void>
│       │   ── AudioTrack extends Track
│       │       └── .createAudioClip()    → Promise<AudioClip>
│       │   ── MidiTrack extends Track
│       │       └── .createMidiClip()     → Promise<MidiClip>
│       ├── .returnTracks[]               Track[]  (same shape as .tracks)
│       ├── .mainTrack                    Track    (same shape)
│       ├── .scenes[]                     Scene[]
│       │   ├── .name                     string (r/w)
│       │   ├── .tempo                    number (r)
│       │   ├── .signatureNumerator       number (r)
│       │   └── .signatureDenominator     number (r)
│       ├── .cuePoints[]                  CuePoint[]
│       │   ├── .time                     number (r)
│       │   └── .name                     string (r/w)
│       ├── .createAudioTrack()           → Promise<AudioTrack>
│       ├── .createMidiTrack()            → Promise<MidiTrack>
│       ├── .createScene(index)           → Promise<Scene>
│       ├── .createCuePoint(time)         → Promise<CuePoint>
│       ├── .deleteTrack()                → Promise<void>
│       ├── .deleteScene()                → Promise<void>
│       ├── .deleteCuePoint()             → Promise<void>
│       ├── .duplicateTrack()             → Promise<Track>
│       └── .duplicateScene()             → Promise<Scene>
│
├── .commands                             Commands
│   ├── .registerCommand(id, fn)          void
│   └── .executeCommand(id, ...args)      void  ⚠ scoped to this extension only
│
├── .environment                          Environment
│   ├── .storageDirectory                 string | undefined  — persistent per-extension storage
│   │                                     macOS: ~/Library/Application Support/Ableton/Extensions Data/<id>/
│   │                                     ⚠ returns undefined in practice (known issue)
│   ├── .tempDirectory                    string | undefined  — scratch, may be cleared between sessions
│   └── .language                         string | undefined  — ISO 639-1 code e.g. "EN", "DE", "JA"
│
├── .resources                            Resources
│   ├── .importIntoProject(filePath)      → Promise<string>  — copies file into project bundle, returns new path
│   └── .renderPreFxAudio(track, start, end)  → Promise<string>  — WAV path in tempDirectory
│
├── .ui                                   Ui
│   ├── .registerContextMenuAction(scope, title, commandId)  → Promise<unregisterFn>
│   │   scopes: "AudioClip" | "AudioTrack" | "MidiClip" | "MidiTrack" | "ClipSlot" |
│   │           "DrumRack" | "Sample" | "Scene" | "Simpler" |
│   │           "ClipSlotSelection" | "AudioTrack.ArrangementSelection" | "MidiTrack.ArrangementSelection"
│   ├── .showModalDialog(url, width, height)  → Promise<string>  — url: file: / data: / https: / http://localhost
│   └── .withinProgressDialog(text, opts, callback)  → Promise<unknown>
│
├── .getObjectFromHandle(handle, Type)    → T extends DataModelObject
└── .withinTransaction(fn)               → T  — groups mutations into one undo step
```

---

## 2. Class inheritance

All SDK objects extend `DataModelObject`. Use `instanceof` when branching on an unknown handle
resolved via `context.getObjectFromHandle(handle, DataModelObject)`.

```
DataModelObject
├── Application
├── Song
├── Track
│   ├── AudioTrack
│   └── MidiTrack
├── Clip
│   ├── AudioClip
│   └── MidiClip
├── ClipSlot
├── TakeLane
├── Scene
├── CuePoint
├── Device
│   ├── RackDevice
│   │   └── DrumRack
│   └── Simpler
├── Chain
│   └── DrumChain
├── TrackMixer        (className: "MixerDevice")
├── ChainMixer        (className: "ChainMixerDevice")
├── DeviceParameter
└── Sample
```

---

## 3. Context menu scopes → command argument

What Live passes as the **first argument** to your command handler:

**Handle scopes** — first arg is a `Handle`; resolve with `context.getObjectFromHandle(handle, ExpectedType)`:

| Scope | Resolves to |
|---|---|
| `"AudioClip"` | `AudioClip` |
| `"AudioTrack"` | `AudioTrack` |
| `"ClipSlot"` | `ClipSlot` |
| `"DrumRack"` | `DrumRack` |
| `"MidiClip"` | `MidiClip` |
| `"MidiTrack"` | `MidiTrack` |
| `"Sample"` | `Sample` |
| `"Scene"` | `Scene` |
| `"Simpler"` | `Simpler` |

**Selection scopes** — first arg is a typed selection object (not a `Handle`):

| Scope | Arg type |
|---|---|
| `"ClipSlotSelection"` | `{ selected_clip_slots: Handle[] }` |
| `"AudioTrack.ArrangementSelection"` | `{ time_selection_start: number, time_selection_end: number, selected_lanes: Handle[] }` |
| `"MidiTrack.ArrangementSelection"` | same as above |

---

## 4. Data shapes

Types passed to or returned from SDK methods.

### NoteDescription
```ts
{
  pitch: number            // MIDI note 0–127
  startTime: number        // in beats
  duration: number         // in beats
  velocity?: number        // 0–127, default 100
  muted?: boolean
  probability?: number     // 0–1
  velocityDeviation?: number
  releaseVelocity?: number
  selected?: boolean
}
```

### ClipLoopSettings
```ts
{
  looping: boolean
  startMarker: number      // in beats
  endMarker: number        // in beats; startMarker ≤ endMarker
  loopStart: number        // in beats
  loopEnd: number          // in beats; loop ≥ 0.25 beats (one 16th note)
}
// When looping is false: loopStart === startMarker and loopEnd === endMarker
// When isWarped is false: positions must be non-negative and looping must be false
```

### WarpMarker
```ts
{ sampleTime: number; beatTime: number }
```

### DeviceParameterValueItem
```ts
{ name: string; shortName: string }  // items of a quantized/enum parameter
```

### Handle
```ts
{ id: bigint }  // opaque — never construct manually; only use handles received from the host
```

---

## 5. Bootstrap: activate() → initialize() → context

`activate()` receives an `ActivationContext`, not the full `ExtensionContext`. Call `initialize()`
to get `context`:

```ts
import { initialize, type ActivationContext } from "@ableton-extensions/sdk";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  // context.application, context.commands, etc. are now available
}
```

`ActivationContext` only exposes `hostApiVersion: string` (the highest version the host supports).
Pass the **lowest API version your extension needs** to `initialize()` — the host preserves older
versions as Live evolves, maximising compatibility.

---

## 6. Enums

```
GridQuantization   NoGrid=0 | EightBars=1 | FourBars=2 | TwoBars=3 | Bar=4
                   Half=5 | Quarter=6 | Eighth=7 | Sixteenth=8 | ThirtySecond=9

WarpMode           Beats=0 | Tones=1 | Texture=2 | Repitch=3 | Complex=4 | ComplexPro=6
```

---

## 7. Non-obvious constraints

- **`insertDevice()` (Track and Chain)** — built-in Live devices only; third-party plug-ins
  cannot be loaded this way
- **`withinTransaction(fn)`** — callback must be **synchronous** (no `await` inside); return
  `Promise.all([...])` to group multiple async operations into one undo step
- **`renderPreFxAudio()`** — output goes to `tempDirectory`, which may be `undefined`
  (see `environment.storageDirectory` ⚠ note in the context tree above)
- **`showModalDialog()` URL schemes** — `file:`, `data:`, `https:`, `http://localhost` only
- **`context.commands.executeCommand()`** — scoped to the calling extension's own registered
  commands; cannot invoke commands registered by other extensions (filed as feature request
  2026-06-08)
