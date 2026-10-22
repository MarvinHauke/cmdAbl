# `vol` and `dca`: fader levels and DCA groups on tags

**Status:** `vol` released in 0.1.3 (2026-10-22, PR #17). `dca` is a draft and gets its own
detailed plan, after [0015](0015-link.md). Trigger: the user wants the
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
3. **`vol` is relative by default** (user, 2026-10-21): `vol -6 #drums` moves every drums fader by
   -6 dB from where it is (Kick at -6 → -12, Perc at -3 → -9), so the balance stays.
   **`--set` makes it absolute:** `vol --set -6 #drums` puts every fader at -6 dB (the same flag
   name as `mute --set`).

4. **`dca` moves back and gets its own detailed plan** (user, 2026-10-21), because it adds devices.
   Direction: one **"cmdAbl DCA" rack** per member track, with each Utility's Gain routed to a
   **rack macro named after the tag**. A new tag on the track adds its Utility and macro; the user
   can read every DCA routing in the device chain (deterministic, visible, automatable per macro).
   Open for the detailed plan (spike first):
   - the Utilities must sit **in series in one chain** (parallel chains would sum the audio);
   - the LOM cannot create macro mappings or rename macros (only `has_macro_mappings`,
     `add_macro`/`remove_macro`; `DeviceParameter.name` is read-only) — likely a shipped preset
     (`.adg`, installed by `cmdabl setup` like the Remote Script, loaded with `browser.load_item`)
     with Utilities pre-mapped to macros 1–16, so at most 16 DCAs per track;
   - naming: `Device.name` is writable, so each Utility can be renamed `dca drums`; whether macro
     labels can follow the tag needs the spike;
   - removing a DCA from a track, and what the rack does with an unused macro.

## Design (draft)

### `vol`

| | |
|---|---|
| What it changes | The track's `mixer.volume`, a DeviceParameter in the SDK (`docs/sdk-tree.md`), so no Remote Script is needed |
| Targets | Paths, names and tags, as for `mute`: `vol -6 /Bass`, `vol 2 #drums` |
| Relative (default) | `vol <dB> <target>…` adds `<dB>` to each fader's current level: Kick -6 → -12, Perc -3 → -9 with `vol -6 #drums` |
| Absolute | `vol --set <dB> <target>…` sets each fader to `<dB>`; `-inf` is allowed |
| Limits | A fader stops at Live's maximum (+6 dB) and at -inf. Relative steps follow a rule (user, 2026-10-22): **`stop`** (default) shrinks the step so no member crosses a limit and the balance stays; **`--clip`** (`-c`) moves each member by the full step and clamps the ones at a limit. A shortened step or a limit is named in a message; the log has the asked and the applied step. Members at -inf stay and don't block. `--set` has no rule. `keep` (remember the overflow) comes with [0015](0015-link.md). |
| Behaviour | It overwrites the fader values. No automation warning for now (decided 2026-10-22); the command's description says it overwrites the fader. It is not marked `destructive` (the one-target confirmation), because a tag reaches all its members on purpose. |
| Undo | All faders are read first, then written in one transaction: one Cmd+Z step, exact. The log's `undo: vol --set <old> <path>` lines restore to 0.1 dB. |
| Output | A successful write is quiet; `/Kick: -6.0 → -12.0 dB` and the undo line go to the log ([0011](0011-logging.md)). A fader whose relative step was cut by a limit is named in a message; `--set` is quiet (the log has old → new). A relative step on a -inf fader leaves it at -inf and doesn't name it (only `--set` lifts it). Below -69.6 dB the fader goes to -inf. Chains: exit 2 for now. |

### The dB ↔ value helper (shared)

- Live's volume parameter runs 0…1 and maps to dB non-linearly.
- **Decided by measurement (2026-10-22):** `cmdabl curve` read Live's `str_for_value` for 1001 values
  (through the bridge op `param_display`). The table is monotonic; 0 dB ≈ 0.850, 1.0 = +6 dB, linear
  at 40 dB per unit from about 0.4 up; 0.001 = -69.6 dB.
- `src/modules/mixTable.ts` holds the table; `src/modules/mixValue.ts` converts by interpolation and
  binary search.

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

- Balance at limits: `stop`/`--clip` now; `keep` and named group controls later in [0015](0015-link.md).

- ~~`vol` syntax~~ — decided (user, 2026-10-21): relative by default, `--set` for absolute.
- Relative steps in dB do not reverse exactly near -inf or a fader limit (`vol -40` then `vol 40`);
  the log's undo line therefore restores the old values with `vol --set`.
- ~~Automation warning~~ — none for now (2026-10-22); revisit if the automation state becomes readable.
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
  - `vol -6 #drums` lowers every drums fader by 6 dB (Kick -6 → -12, Perc -3 → -9); Cmd+Z undoes it
    in one step.
  - `vol --set -6 #drums` puts every drums fader at -6 dB.
  - `vol 2 /Bass` raises the fader by 2 dB.
  - `dca drums -3` inserts the rack with a "dca drums" Utility at -3 dB on every drums track; the
    faders are unchanged.
  - A second DCA on one track adds a second Utility, and both offsets are heard.
  - `dca drums mute` mutes the members while their own mute buttons stay off.
  - `dca --remove drums` removes the Utilities, and the rack when it is empty.
