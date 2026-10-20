# `vol` and `dca`: fader levels and DCA groups on tags

**Status:** Draft (2026-10-20). Order: after 0013, `vol` first, then `dca`. Trigger: the user wants the
DCA workflow of large mixing desks, built on tags (0008).

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0008](0008-tags-and-aliases.md) (tags as the membership list),
[0010](0010-tag-editing.md) (the `board` surface for `dca -l`).

## Context

On a mixing desk, a DCA (formerly VCA) is a control fader without an audio path:

- Its fader offsets the level of every assigned channel and keeps their balance.
- Its mute mutes them without changing their own mute buttons.
- A channel can be in several DCAs, and the offsets add up.
- **Spill** shows only a DCA's members on the surface.
- **Mute groups** are a separate feature.
- A subgroup sums the audio and can be processed; a DCA cannot.

Sources:
[Sound On Sound](https://www.soundonsound.com/techniques/how-use-vca-groups),
[emastered](https://emastered.com/blog/vca-tracks),
[Allen & Heath SQ](https://support.allen-heath.com/hc/en-gb/articles/4402945922833-SQ-Working-with-DCA-and-Mute-Groups).

Live has no VCA. Its group tracks are subgroups. cmdAbl already has the membership list (tags) and
mute groups (`mute #drums`).

## Decisions (user, 2026-10-20)

1. **Two modules.**
   - `vol` changes the faders themselves.
   - `dca` is a gain stage after the fader that remembers its value.
   - `vol` comes first.
2. **`dca` uses one Utility per DCA, in a rack.**
   - Each member track gets one Audio Effect Rack named "cmdAbl DCA" at the end of its chain.
   - The rack holds one native Utility per DCA the track belongs to, named after the tag
     (`dca drums`).
   - The Utility's Gain is that DCA's offset and its Mute is that DCA's mute. Several DCAs add up
     because the Utilities are in series, so no summing code is needed.
   - Each DCA's Gain can be automated in Live.
3. **`vol` covers absolute and relative changes.** The syntax is still open (see Open questions).

## Design (draft)

### `vol`

| | |
|---|---|
| What it changes | The track's `mixer.volume`, a DeviceParameter in the SDK (`docs/sdk-tree.md`), so no Remote Script is needed |
| Targets | Paths, names and tags, as for `mute`: `vol /Bass -6`, `vol #drums -3` |
| Behaviour | Destructive: it overwrites the fader values and works against volume automation. The result says so when the track has automation, if that can be read. |
| Undo | Inside `withinTransaction`, one undo step |
| Output | A successful write is quiet; the old and new values go to the log ([0011](0011-logging.md)) |

### The dB ↔ value helper (shared)

- Live's volume parameter runs 0…1 and maps to dB non-linearly.
- The spike checks whether the parameter's display string (`str_for_value` or `display_value`) can be
  used to search for a value, or whether a fixed table is needed.
- The helper goes in `src/modules/`, for example `src/modules/mixValue.ts`.

### `dca`

**Commands:**

| Command | What it does |
|---|---|
| `dca drums -3` | Sets the drums DCA to -3 dB. |
| `dca drums +=1` | Changes it relative to its current value. |
| `dca drums mute` | Mutes the DCA. |
| `dca drums --reset` | Sets it back to 0 dB. |
| `dca --remove drums` | Takes its Utilities out of the member tracks. |
| `dca -l` | Opens an overview of the DCAs and their members, on `board`. |

**Building it:**

- `Track.insert_device` (Live 12.3+, native devices only; see the
  [LOM Track page](https://docs.cycling74.com/apiref/lom/track/)) inserts the rack.
- A chain is created and the Utilities are inserted into it. The spike tests this.
- **Membership follows the tag:** a track tagged `drums` gets the `dca drums` Utility the next time
  `dca drums` runs. When a track loses the tag, its Utility is removed. When a track's last Utility
  goes, the rack goes too.
- **Where the DCA list lives:**
  - The list of DCAs (name, dB, mute) is stored with `Song.set_data("cmdabl.dca")`, the same way tags
    use `Track.set_data` (`remote-script/cmdAbl/ops/tags.py`).
  - The Utilities hold the actual values and are the source of truth.
- **MIDI tracks** without an instrument have no audio path, so they are skipped and named in the
  result.
- **Spill:** `find #drums` and selection already exist. Hiding the other tracks is not possible
  through the LOM, so that part is deferred.

### Mixing desks: SDKs and protocols

No large vendor offers an SDK for "DCA from a DAW". What can be used are the desks' remote protocols:

| Desk | Protocol | Use |
|---|---|---|
| Behringer X32 / Midas M32 | OSC over UDP, with DCA fader, mute and assignment ([forum](https://behringer.world/viewtopic.php?p=9333)) | The first bridge |
| Yamaha DM7 | OSC ([spec PDF](https://id.yamaha.com/files/download/other_assets/5/2234295/DM7_osc_specs_V110_en.pdf)); older desks use RCP over TCP | Later |
| DiGiCo SD | Generic OSC ([DiGiCo](https://digico.biz/digico-opens-up-the-sd-range-with-generic-osc-control/)) | Partly |
| SSL System T | OSC for faders, mutes and labels ([IT Brief](https://itbrief.co.uk/story/solid-state-logic-expands-system-t-with-osc-support)) | Later |
| Allen & Heath dLive / SQ | A TCP/MIDI protocol | Later |
| Mackie Control / HUI | Live supports them itself; basic control only | Nothing to build |
| Avid EUCON | A closed partner SDK; Live is not a EUCON application ([Avid](https://prod-werp.avid.com/pro-tools/control-surfaces/what-is-eucon)) | Not usable |

**The bridge maps desk DCA N to the cmdAbl DCA of a tag, in both directions:**

- Moving the desk's fader makes the Utility follow.
- `dca drums -3` also moves the desk's DCA.
- Listening needs a UDP socket, either in the Extension Host (like `src/httpTrigger.ts`) or in the
  Remote Script.

## Open questions

- **`vol` syntax.** Recommended: calc operators. `vol #drums -6` sets the value; `vol #drums +=2` and
  `vol #drums -=2` change it. The alternative is a flag, `vol #drums --by -2`.
- Can the automation state of the volume parameter be read, so `vol` can warn?
- **Rack building through the LOM:** does `insert_device("Audio Effect Rack")` work, can chains be
  inserted, and does Utility's gain range cover what a DCA needs (about ±35 dB)?
- Does `dca` also need to act on return tracks and group tracks? Probably yes. Group tracks carry
  audio.

## Phased rollout

1. **Spike** (cmdabl-bridge):
   - the dB↔value mapping;
   - `insert_device` for the rack and the Utility, and the gain range;
   - `Song.set_data` survives saving and reloading.
2. `vol` (cmdabl-modules).
3. `dca` with Utility gain and mute: bridge ops by cmdabl-bridge, the module by cmdabl-modules.
4. `dca -l` on the board.
5. The X32 OSC bridge.
6. Other desks.

## Verification

- Every phase: `npm test` and `npm run build`.
- Live:
  - `vol #drums -6` sets every drums fader to -6 dB, and Cmd+Z undoes it in one step.
  - `vol /Bass +=2` raises the fader by 2 dB.
  - `dca drums -3` inserts the rack with a "dca drums" Utility at -3 dB on every drums track; the
    faders are unchanged.
  - A second DCA on one track adds a second Utility, and both offsets are heard.
  - `dca drums mute` mutes the members while their own mute buttons stay off.
  - `dca --remove drums` removes the Utilities, and the rack when it is empty.
