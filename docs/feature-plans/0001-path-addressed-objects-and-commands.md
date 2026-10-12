# Path-addressed objects & Linux-style commands

**Status:** In Progress (updated 2026-06-08) — triggered by two findings while working on
track search (Phase 1): Drum Rack chains/pads aren't addressable at all (they look like
tracks in Live's UI but are a different object type the palette never sees), and a desire to
drive the palette the way a shell drives a filesystem — `mute /vermona/kick`, multi-target
`rm`, flags — rather than one fuzzy-searchable flat list with one action each.

**Where things stand:** Phase 2 has effectively shipped — `src/ableton/objectTree.ts`
(`ObjectNode`/`LiveRef`/`assignPaths`/`buildObjectTree`) and `src/modules/goto/{resolve,snapshot}.ts`
(`resolveByRoute`/`resolveRef`) are this section's `ObjectNode`/`route`/`resolveRef` design,
covering tracks, group-track children, and devices. Phase 3 has landed *partially*: `mute`/
`solo` (`src/modules/{mute,solo}/index.ts` via the shared `registerTrackToggleCommand` in
`src/modules/trackToggleCommand.ts`) support comma-separated multi-target `/path` syntax —
but `rm`, a generalized `select`, and the `-d`/`-c` kind-disambiguation flags described below
are not yet implemented. Phase 4 (bidirectional bridge + Drum Rack chain provider) has not
been started — `src/ableton/bridge.ts` is still the fire-and-forget one-way channel described
in §2, and `"chain"` only appears as a forward-looking comment/placeholder in `objectTree.ts`/
`resolve.ts`/`types.ts`, not as working code.

## Context

Phase 1 (`fb63563`) gave the palette a flat, fuzzy-searchable list of tracks
(`src/ableton/snapshot.ts`, `src/providers/trackProvider.ts`, `ui/interface.html`'s Fuse-based
`computeItems()`), with exactly one non-command action: `select`, dispatched through
`src/extension.ts`'s `dispatch()` → `resolveTrackIndex` → the UDP bridge
(`src/ableton/bridge.ts` ↔ `remote-script/cmdAbl/cmdabl.py`) because the Extensions SDK
cannot change Live's selection or view — only the companion Remote Script's full LOM access
can.

Two things now push past that shape:

1. **Drum Rack chains/pads aren't `Track`s.** When a Drum Rack's chains are shown in Session
   View, each pad looks like its own track lane — but it's a `Chain`/`DrumChain` object living
   on `RackDevice.chains` (`Track.devices[i].chains`), a completely different branch of the
   object model that `snapshotTracks` never walks. They're invisible to search and selection
   today, and — a real constraint, not just a gap — **the Extensions SDK
   (`@ableton-extensions/sdk@1.0.0-beta.1`) doesn't expose `Chain.name` at all** (verified
   against `node_modules/@ableton-extensions/sdk/dist/index.d.mts:913-946`: `Chain`/
   `DrumChain` only expose `devices`, `mixer`, `insertDevice`/`deleteDevice`/
   `duplicateDevice`, and for drum chains `receivingNote`). Only the Remote Script's LOM
   access can read a pad's display name ("Kick", "Snare", …).
2. **The interaction model the user wants is shell-like, not single-action-per-item:**
   address any object by a path (`/vermona/kick`), prefix it with a command
   (`mute /vermona/kick`, `rm -d /vermona/kick`), operate on several targets at once
   (`mute /a /b`), and use flags to disambiguate what kind of thing a path segment names
   (`-d` for "device", `-c` for "chain"). And — explicitly — design it so this isn't the last
   object type or command ever added.

"Done" for this plan is: any addressable object (track, group track, device, and — once the
bridge supports it — Drum Rack chain) can be referenced by a fuzzy-matchable path; a small set
of Linux-flavored commands (`mute`, `solo`, `rm`, `select`) can act on one or many such paths
with flags to disambiguate; and the seams for adding the *next* object type or command are
obvious from how these were built.

## Goals / Non-goals

**Goals**
- Path addressing: type `/vermona/kick` (fuzzy-matched per segment, not exact-string) and
  reach any addressable object — tracks, group-track children, devices, and (pending the
  bridge work) Drum Rack chains.
- Command-before-path syntax: `<command> [flags] <path...>`, Linux-`getopt`-ish — short
  (`-d`) and long (`--device`) flags, multiple positional path arguments.
- Multi-target operations: `mute /vermona/kick /vermona/snare` mutes both in one go.
- A small built-in command set that demonstrates the model end-to-end: `mute`, `solo`, `rm`,
  `select` (the last generalizes today's track-only select action).
- A documented seam for "the SDK can't read/do X, but the LOM can" (the chain-name problem is
  the first instance, not the last) — a bidirectional bridge protocol.
- Clear guidance (see §Plugin vs. core heuristic) for what should ship by default vs. register
  conditionally, so the palette doesn't get cluttered as object types/commands grow.

**Non-goals (for now — explicitly deferred, not forgotten)**
- Wildcards/globs in paths (`/vermona/*`). Multi-target works via *multiple explicit path
  arguments*; pattern-based selection is a natural follow-up once the grammar exists, but adds
  matching-semantics questions (does `*` cross kind boundaries? match folded children?) that
  deserve their own design pass.
- Relative paths / "current selection" as an implicit root. Everything resolves from the song
  root; relative addressing is a UX nicety that can layer on top later.
- Renaming, moving, duplicating, or creating objects via the palette. `rm`/`mute`/`solo`/
  `select` are read-or-toggle-or-remove; mutating structure is a bigger trust/undo
  conversation to have separately.
- Designing *every* future object type (clips, scenes, returns, cue points, …) up front. This
  plan designs the tree/path/grammar/dispatch model generically enough that those slot in
  later as new providers — see Phase 4 for chains as the worked example of "adding a kind".

## Architecture

Five pieces, each replacing or generalizing a Phase-1 counterpart:

### 1. Addressable-object tree

Replace the flat, track-only `snapshotTracks` (`src/ableton/snapshot.ts`) with a tree walk
over everything that has a stable place in Live's object hierarchy: `song.tracks` → group
children → `track.devices` → `rackDevice.chains` (and, later, other branches — clips, scenes,
…). Proposed shapes (naming open to bikeshedding — see §Open questions):

```ts
type NodeKind = "track" | "device" | "chain"; // grows as new branches are added

interface LiveRef {
  handleId: string;   // host handle id — primary re-resolution key (today's PaletteItem.id)
  route: number[];    // index chain from the song root: [2, 1] = song.tracks[2].devices[1]
  kind: NodeKind;
}

interface ObjectNode extends LiveRef {
  name: string;
  path: string;           // "/Vermona/Kick" — slash-joined names from the root
  children: ObjectNode[];
}
```

Build it top-down (recursing `song.tracks` → `.devices` → `.chains`); compute display paths
either while walking down or bottom-up via `DataModelObject.parent` — every SDK object exposes
a generic `.parent` getter (`index.d.mts:369-371`), which is a clean way to derive/verify a
path without re-deriving the hierarchy by hand.

This tree feeds two consumers: it flattens into today's `PaletteItem[]` for the existing fuzzy
"type a name, hit enter" UX (now covering devices, and chains once §2 lands), and it's the
structure path arguments resolve against (§4).

### 2. Bidirectional bridge

The UDP bridge (`src/ableton/bridge.ts` ↔ `remote-script/cmdAbl/cmdabl.py`) is currently
fire-and-forget and one-way (extension → script). Reading `Chain.name` — and any future
"SDK can't, LOM can" need — requires request/response:

> **Naming source matters**: the display name for a Drum Rack pad must come from the
> `DrumChain`/`Chain` itself (the name the user sees and edits in Session/Drum Rack view —
> "Kick", "Snare", …), *not* from its first device. Naively reading "the name of whatever's
> first in the chain" surfaces irritating defaults like "Default Track" or "External
> Instrument" instead of the pad's actual name. Whatever the Remote Script query (`chain_names`
> below) reads, it must read the chain's own name property — confirm this resolves correctly
> against a Drum Rack with custom-named, non-default-instrument pads before considering Phase 4
> done; a chain whose first device is an "External Instrument" is exactly the case to test.

- The message shapes (`{v, id, op, args}` → `{v, id, ok, result|error}`) and the `chains` operation
  are specified in "Phase 4 protocol proposal" below; the sketch of a `query` message that was
  here is superseded by it.
- The Remote Script already has the sender's address from `recvfrom()`
  (`remote-script/cmdAbl/cmdabl.py:_drain_socket`) and replies to it.
- Extension side: a small pending-request map keyed by `reqId`, with a timeout. If the script
  isn't installed or doesn't answer, the request times out and the affected nodes (chains, in
  this case) are simply omitted — the same fail-soft posture as today's selection no-op when
  the bridge is absent (`src/ableton/bridge.ts`'s doc comment: "fire-and-forget … selection
  silently no-ops").

This becomes *the* general mechanism for "the palette needs LOM-only data" — built once, used
by chains now and by whatever needs it next.

### 3. Generalized re-resolution

`resolveTrackIndex` (`src/ableton/resolve.ts:11-22`) re-walks `song.tracks`, matches by handle
id, and falls back to the recorded index — because handles aren't permanent and the SDK
forbids reconstructing one from a stored id. Generalize this into `resolveRef(context, ref:
LiveRef)`: walk `route` step by step (`song.tracks[i]` → `.devices[j]` → `.chains[k]`),
re-matching each step's `handleId` with its recorded index as fallback. Same principle, just
recursive over a route instead of a single index.

### 4. Linux-style command grammar

Both the webview parser (`ui/interface.html`'s `parse()`/`computeItems()`/`resultFor()`,
currently ~lines 126-174) and the host payload (`PaletteResult` in `src/types.ts`) need to
grow from "command + flags" into "command + flags + path arguments":

- **Tokenizer**: a small hand-rolled, shell-like tokenizer (no new dependency) that splits on
  whitespace but respects quotes — necessary because track/device/chain names contain spaces
  (the existing `parse()` already has a comment about "Opal Lead"). Example:
  `mute "/Opal Lead/Reverb" /Drums/Kick -d` → `['mute', '/Opal Lead/Reverb', '/Drums/Kick', '-d']`.
- **Classification**: first token = command name; tokens starting with `-`/`--` = flags
  (validated against the command's declared `FlagDef[]`, as today); tokens starting with `/` =
  path arguments; anything else falls back to today's free-text behavior.
- **Path completion**: when the active token starts with `/`, split on `/`, resolve every
  segment but the last against the object tree, and fuzzy-match the last segment against that
  node's children. Mirrors the existing Tab-autocomplete (`ui/interface.html:231-245`) — when
  completing a multi-word name, auto-wrap it in quotes so users rarely type quotes by hand.
- **Payload**: extend `PaletteResult`/`resultFor()` with `paths: string[]` alongside the
  existing `flags: string[]`. The host resolves each path string against its tree snapshot
  into `LiveRef`s, then `resolveRef`s each at execute time — generalizing the existing
  `resolveTrackIndex` → `selectTrack` flow (`src/extension.ts:83-97`) from one target/one kind
  to N targets/N kinds.
- A bare path with no leading command (`/vermona/kick` + Enter) defaults to `select` — this
  unifies "jump to X by typing its name" (today's UX) with "jump to X by typing its path".

### 5. New commands — mostly without the bridge

Reading the SDK surface more closely turned up good news: `mute`, `solo`, and deletion are
**directly supported**, no bridge needed —
`Track.mute`/`Track.solo` are read/write properties, `Song.deleteTrack(track)`,
`Track.deleteDevice(device)`, and `Chain.deleteDevice(device)` all exist directly on the SDK
objects (`index.d.mts:502-549` for `Track`, `:913-935` for `Chain`). Only *selection/view*
changes are SDK-blocked. So:

- `mute [-d|-c] <path...>`, `solo [-d|-c] <path...>`, `rm [-d|-c] <path...>` — resolve paths to
  nodes, dispatch directly through the SDK based on `node.kind`. Default kind is `track`;
  `-d` scopes resolution to devices, `-c` to chains — this is how ambiguity gets resolved when
  a path segment could name more than one kind of child (e.g. a track and a device both named
  "Kick").
- `select <path...>` — generalizes today's track-only `select` action; tracks still need the
  bridge (as today), and chain/device selection-equivalents (`is_showing_chains`,
  `view.selected_device`) extend the bridge protocol the same way `select_track` did, when
  that phase is implemented.

## Plugin vs. core heuristic

`Provider` (`src/types.ts`) and `CommandRegistry` (`src/commandRegistry.ts`) already *are* the
plugin seam — "plugin" doesn't need a new mechanism, just optional/conditional registration.
The question "should X be core or a plugin" reduces to one rule:

> **Core** if it's universally present in every Live Set and works with zero extra
> infrastructure. **Plugin/optional** if it depends on a specific workflow, needs the bridge to
> fetch extra data, or is opinionated in a way power users might want to swap out.

Applying it to what this plan touches (and as a worked example for classifying future ideas):

| Candidate | Lands as | Why |
|---|---|---|
| Tracks, group tracks, devices | Core providers, always registered | In every Set; SDK reads their names directly; `mute`/`solo`/`select`/`rm` all work without extra infrastructure (or with the bridge cmdAbl already ships) |
| `mute`, `solo`, `rm`, `select` + the path/flag grammar | Core | Universally useful; the grammar is infrastructure everything else builds on |
| Drum Rack chains | **Optional provider**, registered only after a capability handshake confirms the bridge can answer `chain_names` queries | Needs the bidirectional-bridge upgrade; irrelevant to users who don't build Drum Racks; the cleanest first example of "a provider that activates conditionally" |
| Future ideas (clips, scenes, return tracks, device-specific commands, …) | Start optional; promote to core only if broadly useful *and* infrastructure-free | Keeps the default palette lean — most users never touch most of these |

A useful self-check for whether the architecture stayed generic enough: adding the chain
provider (Phase 4) should require writing a new `Provider` plus a capability check — not
touching the grammar, resolution, or dispatch core. If it does need core changes, that's a
signal the abstraction drew its lines in the wrong place.

## Open questions

Left open deliberately — easier to settle with real data/usage than to guess up front:

- **Path-quoting UX**: how much should the palette auto-quote vs. require the user to type
  quotes for multi-word segments? The plan above leans on autocomplete doing the quoting, but
  manually-typed paths with spaces need a real answer.
- **Genuine ambiguity under `-d`/`-c`**: if `-d` is given but *two* devices on the resolved
  parent share a name, what happens — first match, error, or a disambiguation prompt?
- **Bridge request timeouts**: proposed 500 ms, unmeasured; see "Phase 4 protocol proposal" (§2, §6).
- **Naming**: `ObjectNode`/`LiveRef`/`route`/`kind` are working names from this design
  session — worth a final pass once the shapes exist in code and have call sites to read
  naturally from.
- **Folded-group interaction**: Phase 1 already had to teach the Remote Script to unfold
  parent groups on `select_track` (`cmdabl.py`'s `_unfold_parents`); does `select` on a device
  or chain need the analogous "make my ancestors visible" behavior, and if so, where does that
  logic live generically rather than per-kind?

## Phase 4 protocol (confirmed by the user 2026-10-11; build step 1 in progress)

Supersedes the sketch in "Architecture §2". Decisions are marked **[D1…]** with the user's answer.
"Measured" means observed in Live; nothing below is measured yet — every number is an assumption
until the first Live test of build step 1. LOM facts are "from the LOM docs, to confirm in Live".

### 1. Transport

Stay on UDP, 127.0.0.1, script port 27185. The extension binds one socket on an ephemeral port
for its lifetime and sends from it, so replies go to the sender address the script already gets
from `recvfrom()`. No second fixed port, no TCP, no files.

- Why: the script runs in Live's Python on the main thread; the socket is drained from
  `update_display` (~10 Hz, assumed from the existing script comment). A UDP socket needs no
  threads and no accept loop.
- Cost: a request waits for the next drain, so a round trip is 0–100 ms plus Live's main-thread
  load (assumed). Loopback delivery is reliable in practice but not guaranteed.
- The script replies in the same drain pass that read the request.
- **Size rule** (limits assumed: the script reads with `recvfrom(4096)`; macOS caps a UDP
  datagram at 9216 bytes by default): requests stay under 2 KB (they are routes and names). A
  reply is kept under 4 KB; `chains` takes `offset`/`limit` and the result carries `total`, so
  a Drum Rack with many long pad names is read in pages. If a reply would still not fit, the
  script answers `too_large`. `sendto` failures are caught and logged, never raised.
- **[D1] decided:** a faster drain only if the Live measurement asks for it (options and
  evidence in §6, "Draining faster"; a re-arming `schedule_message` would *not* be faster).

### 2. Message format

Request: `{"v": 1, "id": "<string>", "op": "<name>", "args": { … }}`.
Reply: `{"v": 1, "id": "<same>", "ok": true, "result": { … }}` or
`{"v": 1, "id": "<same>", "ok": false, "error": {"code": "<slug>", "text": "<message>"}}`.

`v` is the protocol version, one number, the same as in 0004; `hello` reports it too.

- Error codes and the exit code the bridge maps them to:

  | Code | Meaning | Exit code |
  |---|---|---|
  | `stale` | the route resolves but `expectName` differs | 1 — "the Live Set changed, run again" |
  | `out_of_range` | the route does not exist | 1 — same text |
  | `unsupported` | the LOM refuses (a LOM refusal; no 0.1.0 op can hit it yet, it is for later write ops) | 1 |
  | `failed` | exception in the script, logged in Live's log | 1 |
  | `too_large` | reply would exceed the size rule | 1 |
  | `bad_request` | malformed args | 1 (a bug) |
  | `unknown_op` | the script lacks the op | 5 — "installed script is outdated" |
  | `protocol_mismatch` | request `v` differs from the script's | 5 — see §3 |

  **[D3] decided:** `stale`/`out_of_range` are exit code 1 with the text "the Live Set changed;
  run the command again". `BridgeResult` therefore allows only 1 | 5.
- Today's script logs "unknown cmd None" for every `hello` it receives; that line is expected, not a bug.
- The old one-way `{"cmd": …}` messages were removed with script 0.2.0 (this reverses an earlier
  promise to keep them for one release; nothing had been released before 0.1.0). An extension older
  than 0.2.0 against this script selects nothing and gets no reply.
- Timeout: 500 ms (≥ 300 ms by 0004; assumed). The caller (`bridge.ts`, never a module) sees:
  - no `hello` reply at all → **unavailable**, exit code 5;
  - a timeout *after* a successful `hello`, for a request that changes Live → **unknown end
    state**, exit code 1 ("no answer; check Live");
  - a timeout on a read → exit code 1, nothing changed.
- No retries (reads included; a read that times out is reported, the caller may ask again).
- **Script rules**: every op handler is wrapped (nothing raises into Live); every parseable
  request with an `id` gets exactly one reply; unparseable or id-less datagrams are logged and
  dropped; routes and argument types are validated before any LOM access; the script never caches
  LOM objects and does one thing per op.
- **Security**: any local process can send to 27185. No access token while the ops only select and
  read (decided). **Rule:** a token is mandatory before the first op that changes or deletes
  something.

### 3. `hello`, installation, version

`{"v": 1, "id": …, "op": "hello"}` → `{"script": "0.1.0", "v": 1, "ops": ["select", "track_facts", …]}`.

- `hello` is answered whatever `v` the request carries. Any other op with a different `v` gets
  an error reply (`protocol_mismatch`) carrying the script's `v`, so a mismatch never looks like
  "not running".
- **Installed**: assumption — the User Library `Remote Scripts/cmdAbl` folder holds the files and
  a `VERSION` line in `protocol.py`. This reads outside the bundle (a stricter OS sandbox is
  announced) and the User Library location is configurable in Live, so "cannot tell" is a valid,
  fail-soft answer.
- **Running**: `hello` answers. Installed but silent = "not enabled in Live's preferences, or
  Live not restarted".
- **Outdated script**: today's script logs "unknown cmd" and never replies, so `hello` times out.
  When the installed-file check says "installed, old version", the text is "installed script is
  outdated; run `cmdabl --setup`, restart Live" — not "not running". **Behaviour change**: `goto`
  selects with the old script today and returns exit code 5 after build step 2.
- **Mismatch**: `v` differs, or an op the extension needs is missing from `ops` → exit code 5 with
  both versions and "run `cmdabl --setup`, restart Live".
- **Versioning rule (user, 2026-10-12).** The script version follows the extension's release
  line (cmdAbl 0.1.0 ships script 0.1.0; until the first release a changed script keeps `0.1.0`).
  From the first release on, the third number goes up for every change to the script that is a
  fix or a compatible addition (a new op, a new optional argument); middle number: only with a release whose script is not compatible with the previous
  release's extension (an op removed or changed in meaning); protocol `v`: only when the envelope
  changes. Compatibility is decided by the op list from `hello`, never by comparing versions;
  versions are only compared for equality (installed-script check, `cmdabl --bridge`).
  *During development* an installed copy from before a change has the same version as the new
  one, so the installed-file check says "current" and `cmdabl --bridge` shows no "(this extension
  ships …)"; only the op list tells, and only for a missing op — a fix inside an existing op is
  invisible. A linked install plus a Live restart is the development routine; do not trust the
  version number until the first release.
  The script numbers 0.2.0 … 0.6.0 named elsewhere in this plan are the development-day numbers
  before the reset to 0.1.0; they are history, not versions to look for.
- `cmdabl --setup` (renamed to `cmdabl setup` in the syntax freeze, roadmap step 3; the texts above follow the rename) needs the installed `VERSION` (read from the file, no `hello`), and after
  copying always says that Live must be restarted (Python is loaded once per start).
- The extension sends `hello` lazily on first bridge use and caches the answer for the session;
  the cache is dropped on the first timeout.

### 4. Operations for 0.1.0 (roadmap order)

Every op addresses an object with `{scope, route}`. A route alternates *track index, device
index, chain index, device index, …* starting at the collection named by `scope`; its length
says what it points at (1 = track, 2 = device on the track, 3 = chain, 4 = device in a chain,
…). `expectName` is the name the extension saw when it built the tree.

| Op | Args | Result |
|---|---|---|
| `select` | `{scope, route, expectName}` | `{name}` once the script read the selection back (track: `song.view.selected_track`; device: `track.view.selected_device`; a chain route selects the chain in its rack's view); `stale` / `out_of_range`; if the read-back differs: `failed` |
| `track_facts` | `{targets: [{scope, route, expectName?}, …]}` (routes of length 1, at most 20) | `{tracks: [{can_be_armed, is_foldable, is_grouped, arm} (+ `name` only without `expectName`) \| {error: {code, text}}, …]}` in the order given — several tracks in one reply (one request per command); `arm` is `null` unless `can_be_armed` (reading it raises otherwise); a stale or missing target is its own `error` entry, the others are still answered |
| `chains` | `{targets: [{scope, route, offset?}, …]}` (routes of rack devices, at most 20) | `{racks: [{kind: "rack"\|"drum", total, offset, chains: [{name, note?}], next?} \| {error: {code, text}}, …]}` — all racks of the Set in one request; names are `Chain.name` in `rack.chains` order; an entry that does not fit the 3.4 KB reply budget stops early and carries `next` (ask again with that offset) |
| ~~`select_chain`~~ | — | folded into `select`: a route of length 3 (or a nested chain) selects the chain in its rack's view; the Drum Rack pad lookup is unverified until Live |
| `selection` | `{}` | `{scope, route, name}` for track, plus `device`/`chain` when set |

- **Verified in Live (2026-10-12, script 0.3.0):** `can_be_armed` is *true* for a MIDI track whose
  input device is unavailable (the arm button is greyed out, so the fact does not detect it); the
  LOM's `arm` stays false after the SDK wrote true — the SDK's read of `arm` is wrong, the LOM's is
  right, so `arm` is read through `track_facts`. Group, return and main tracks refuse arming.
- `is_group` is not a LOM property: group tracks are `is_foldable`; `is_grouped` means inside a
  group. Both from the LOM docs, to confirm in Live (also whether a group track is armable).
- `select` unfolds parent groups first, as `_unfold_parents` does today.
- `chains`: `index` is the index in `device.chains`, on both sides; the extension checks the
  count against the SDK's `rack.chains` so names cannot attach to the wrong chain. The name is
  `Chain.name`; for a drum chain, the pad's name if the chain's name differs is **unverified**
  (a pad can hold more than one chain). `note` may be redundant with the SDK's
  `DrumChain.receivingNote`.
- `select_chain` on a drum rack: a DrumChain has no back reference to its pad as far as the LOM
  docs show; finding the pad means scanning `drum_pads`. **Unverified**; first Live test.
- **`showChains` on `select` (proposal 2026-10-12, user wish `goto --unfold` / `find --unfold`).**
  Selecting a pad selects it in the Drum Rack but leaves the track's chains folded in the Session
  mixer; the user likes that as the default and wants an option to show them.
  - *Evidence (LOM docs, bundled skill references `track.md`, `rack.md`, `device.md`):*
    `Track.can_show_chains` (R, "1 if track contains an Instrument Rack device that can show
    chains") and `Track.is_showing_chains` (R/W, observable, "Instrument Rack chain visibility in
    Session View"); `RackDevice` has the same pair. *Assumptions, to confirm in Live:* that a track
    with a Drum Rack reports `can_show_chains` true (the user's mixer shows Drum Rack chains as
    columns, so very likely), that setting `is_showing_chains` on the *track* is what unfolds those
    columns, and that nothing else (selection) changes.
  - *Proposal:* an optional boolean `showChains` in `select`'s args, default false. After the
    selection (and only if it succeeded) the script resolves the route's track; if
    `can_show_chains` and not `is_showing_chains` it sets `is_showing_chains = True` and reads it
    back. It never sets it to false (nothing that is already shown is folded). Reply: the usual
    `{name}` plus `chains_shown: true | false | null` — `null` when the track cannot show chains
    (the flag was ignored), `false` when the write did not take. A selection that succeeded is
    never turned into a failure by this.
  - *Token:* not a writing op — it changes view state like the selection does and is reversible
    by the user in one click. One reason to reconsider: Live stores the expanded state in the Set
    (the Set becomes "modified"); it changes no content. The user decides.
  - *Extension API:* `select(bridge, node, { showChains?: boolean })` in `bridgeOps.ts` returns
    `{ name, chainsShown: boolean | null }`; `cmdabl-modules` maps `--unfold` to it for `goto`
    and `find` (and, per its own design, for `next`/`prev`). Built in script 0.6.0 (user confirmed 2026-10-12). `can_show_chains` / `is_showing_chains` are
    LOM facts not yet seen in Live (unverified until the Live test). Whether `next`/`prev` take
    the flag is up to the command side; it must not be the default. `chainsShown` is `null` when
    not asked for or when the track cannot show chains.
- Identity stays the route, verified by `expectName`; nothing is cached in the script.
- On a timeout, a *tree node* (chains) is omitted; a *command* answers with code 5/1 instead.

### 5. What modules see

`src/ableton/bridgeClient.ts` gives the `Bridge` (`available()`, `ping()`, `state()`); the typed
operations are functions in `src/ableton/bridgeOps.ts` that take it: `select(bridge, node)`,
`trackFacts(bridge, node)`, `chains(bridge, node)`, `selection(bridge)`. All are async, never throw and return
`BridgeResult<T> = {ok: true, value: T} | {ok: false, code: 1 | 5, text: string}`. `requires: ["bridge"]` makes the platform await `available()` before the handler (it sends
`hello` when the state is unknown, up to the timeout); no answer → exit code 5 with the install
hint, the handler is not run. Only the palette uses the cached state (unknown = not marked) and never waits for `hello`, so a
missing script cannot delay opening it. A module never opens a socket or parses a reply.

### 6. Open questions and risks

- **[D2] Does the script run while a modal dialog is open?** Unknown. Live's main thread may not
  call `update_display` during a modal; the extension's dialogs are modal. The design avoids
  needing it (the palette closes before a command runs), but `select` inside a pick flow would
  stall if it does. Related to the dialog-hang work: a request sent in the continuation of a
  dialog close may meet a stalled main thread and time out, and a first-use timeout reads "not
  running". First Live test: send `hello` while the pick list is open and time it.
- Latency per round trip: assumed 0–100 ms, unmeasured. The tree build never does one request
  per device; chain names are fetched only for racks an address touches.
- Script reloaded mid-session: the cached `hello` is dropped on the first timeout.
- Two Live instances: the second bind fails (logged). Out of scope.
- Port 27185 taken: logged on bind failure; the extension sees "unavailable".
- Windows is out of scope for 0.1.0 (macOS-only).

#### Draining faster than one `update_display` tick

Question: can the script read its socket more often than once per display tick? Researched
2026-10-11 from the framework bundled with Live 12 (`MIDI Remote Scripts/_Framework`, `ableton/`,
compiled `.pyc` only — read via `strings` and constant extraction, no sources) and the LOM skill
docs. **Evidence** = read from those files; **assumption** = not backed here.

1. **Tick rate.** `ControlSurface.update_display` advances its task group by
   `Defaults.TIMER_DELAY`, which is `0.1` (evidence): the framework itself assumes ~10 Hz, one
   call per 100 ms. That Live really calls it every 100 ms is the long-standing community value
   and consistent with our 14 / 24 / 43 ms single measurements (a wait of 0–100 ms); not
   documented by Ableton in the LOM docs. `cmdabl --bridge` min/median/max over 20 round trips
   (cmdabl-core) is the measurement that settles it.
2. **Mechanisms.**
   - `schedule_message(delay_in_ticks, fn)` — **no gain** (evidence): it adds a `Task.sequence`
     with a delay to the control surface's task group, and that group is only advanced from
     `update_display`. Re-arming it every tick is the same 10 Hz.
   - `Live.Base.Timer(callback=…, interval=<ms>, repeat=<bool>)` with `.start()` / `.stop()` —
     used by Ableton's own scripts (Push 2 `NotificationComponent` creates it with
     `int(time * 1000)` as interval, Move's `__init__` with a literal small interval and
     `repeat=True`; evidence from the bytecode constants). The interval unit is milliseconds
     (inferred from the Push 2 use). **Assumption:** the callback runs on Live's main thread
     like `update_display`, and a short interval (10–20 ms) is honoured; neither is documented
     or measured here.
   - A Python thread blocking on the socket: not an option — LOM access from another thread is
     unsafe (LOM skill: "all state modifications MUST happen on the main thread"). A thread may
     only *read* the socket and queue datagrams, still handing over on a main-thread tick, so it
     brings nothing over a fast timer.
3. **Risks and recommendation.** A repeating timer costs one non-blocking `recvfrom` per fire
   (microseconds when the queue is empty) on Live's main thread; at 20 ms that is 50 wakeups per
   second against the existing 10 — **assumption**: not measurable as audio dropouts (audio runs
   on its own thread), but only a Live test can show it. Behaviour while a dialog is open is
   untested for the timer; for `update_display` it is **measured**: replies still arrive with the
   palette open (24 ms). Keep the 32-datagram cap per fire. **Recommendation:** do nothing unless
   the 20-round-trip max is above 100 ms. Then add a `Live.Base.Timer` (interval 20 ms,
   `repeat=True`, started in `__init__`, stopped in `disconnect`) that calls the same
   `_drain_socket`, keeping `update_display` as the fallback if the timer cannot be created;
   Live test: round trip min/median/max, CPU in Live's meter during idle for a minute, the
   timer stops when the control surface is deselected.

**Rule: one request per command.** A command needs one request to the script in the normal case
(`hello` is cached); an op that needs several pieces of data returns them in one reply. Checked
against §4: `select`, `track_facts` and `selection` are one request each. `chains` is paged
(`offset`/`limit`) for the size rule in §1; a rack with the usual number of named chains fits
one page (~40 bytes per entry, ~100 per 4 KB page), so the normal case is one request; a very
large rack needs more, which is the size limit speaking, not a design gap.

#### Chain names in the tree (step 4 design)

The SDK's `Chain` has no `name`, so chain nodes need the script, but the tree is built
synchronously on every command. The names therefore come from a **cache, refreshed in the
background** (`src/ableton/chainNames.ts`):

- `findRacks(song)` lists every rack the SDK sees (a device with `chains`, nested ones included)
  with its route, handle id and chain count.
- One `chains` request asks for **all racks of the Set** (≤ 20 per request, paged only by the size
  budget), so a refresh is one round trip, ~14 ms (measured).
- `buildObjectTree` reads names from the cache and **never waits**: a cached entry is used only
  while the SDK still shows the same rack (handle id) with the same chain count; otherwise the
  rack's chains are simply absent. Each build calls `scheduleRefresh` (stale-while-revalidate:
  not more often than every 2 s, every 10 s while the script is unavailable, never two at once).
  The palette opening builds the tree, which warms the cache before the user commits a command.
- A renamed pad is seen after the next refresh; until then `select`'s `expectName` makes a
  command on the old name answer "the Live Set changed; run the command again".
- Without the script, or an older one (no `chains` op): the refresh fails quietly, the cache
  stays empty, no chain nodes and no errors.
- **Known limit:** the first palette open after the extension starts has a cold cache, so the
  chains are missing from the palette *list* on that one open (typed paths and `find` build a
  fresh tree and see them from the second build on). Accepted; `openPalette` does not await a
  refresh. Revisit if the user notices.
- **One build behind:** the palette's item list is the snapshot of the build that *starts* the
  refresh, so chains show in the first palette only after a rack was seen once; a typed path
  works at once (the command builds again). If it annoys: refresh at activation and after `select`.
- The throttle delays instead of dropping: a trigger inside the window leaves one trailing refresh.
- Names are valid only for the exact sequence of the SDK's chain handle ids of that rack (a swap,
  or a delete plus an add, drops the names until the next refresh). Any future op or SDK command
  that acts on a chain node must verify the name through the script first (as `select` does).
- While the script is unavailable each attempt is one `hello` (500 ms) at most every 10 s of
  activity; it also rewrites the cached state `requires` reads. Harmless.
- **Verified in Live (2026-10-12, script 0.4.0):** selecting a Drum Rack pad through `select` with
  a chain route works (`find vermona kick` found it and the pad was selected in the rack view).
- **Bug found in Live and fixed (script 0.4.1):** the chains of an Instrument Rack were missing.
  Cause (from the LOM docs, reproduced with a fake that raises like the LOM): `has_drum_pads` is
  "only available for Drum Racks", reading it on an Instrument Rack raises something other than
  `AttributeError`, so `getattr(…, default)` did not help and the whole rack was answered as
  `failed` and left out. The script now asks `can_have_drum_pads` first and guards both reads.
  The refresh also writes one log line per change (`cmdAbl: chains refresh: n racks asked, m
  answered, k chain names; skipped: …`) so a missing rack shows its reason.
- Unverified in Live: `in_note` on drum chains. **Not covered:** racks nested inside a chain —
  their chains are not in the tree (`chains` itself accepts nested routes; the tree build does
  not walk into chains yet).
- Behaviour changes: `goto <name>` also matches pads (a name shared by a track and a pad asks to
  pick); `goto` on a chain runs `select` with a route of length 3 (`rack.view.selected_chain`,
  unverified). A 0.3.0 script keeps working (the op list decides); only `cmdabl --bridge` differs.
- Chain nodes: `kind: "chain"`, route `[track, device, chain]`, path under the rack
  (`/Vermona MIDI/Drum Rack/Kick`), no children in step 4 (devices inside chains stay out of the
  tree; the route scheme already addresses them).

### 7. Build order (each step has a Live test)

1. Script: `hello` + request/reply plumbing, `VERSION`; extension: socket, pending map, timeout,
   `bridge.available()`. Live: round-trip time; script stopped → exit 5; old script → "outdated";
   `hello` during an open dialog (D2).
2. `select` with read-back and `expectName`; `requires: ["bridge"]` in `goto`. Live: renamed
   track → `stale`; unfold a folded group.
3. `track_facts`; `arm` on a group / return track reports instead of doing nothing.
4. `chains` + chain nodes in the tree behind `hello`; a Drum Rack with custom pad names and an
   External Instrument chain (the case from §2).
5. ~~`select_chain`~~ folded into step 4: `select` already takes chain routes (rack view); only the
   Drum Rack pad lookup stays unverified until the Live test (a pad's chain is selected through
   `rack.view.selected_chain`; if that fails the answer is `unsupported`).
6. `selection` read for follow mode.
7. `cmdabl setup` (today `cmdabl --setup`) version check and restart hint.

### 8. Code layout (approved by the user 2026-10-11)

Measured in Live after step 1: a `hello` round trip takes 14 ms, and 24 ms with the palette
open — the script keeps answering while a dialog is open, so no faster drain is needed (D1, D2).
After `cmdabl --setup` Live must be restarted before the new script answers.

Remote Script (`remote-script/cmdAbl/`):

| File | Job |
|---|---|
| `__init__.py` | entry point for Live |
| `cmdabl.py` | the control surface: socket, read per tick, hand over. No operation logic |
| `protocol.py` | message format, errors, `hello`. No Live imports |
| `routes.py` | turn `{scope, route}` into a Live object; reports `stale` / `out_of_range` |
| `ops/__init__.py` | the list of operations; `hello` reports exactly this list |
| `ops/select.py`, `ops/tracks.py`, `ops/chains.py`, `ops/selection.py` | one file per group |

Operations get the song passed in and import nothing from Live, so they are tested with fake
objects in `tests/remote-script/` (`fake_live.py`, one test file per operation file). The old
one-way `cmd` messages and `legacy.py` were removed after `goto` moved to `select` (script 0.2.0 in
Live, 2026-10-12). A stale `legacy.py` may remain in an existing install (`cp -R` does not delete);
nothing imports it, so it is harmless.

Extension (`src/ableton/`): `bridgeProtocol.ts` (message types, error → exit code),
`bridgeClient.ts`, `bridgeFake.ts`, `bridge.ts` (transport, fake, access) and `bridgeOps.ts`
with one typed function per operation (`select()`, `trackFacts()`, …). Modules call the typed
functions only, never `request("name", …)` with loose arguments.

Response time (user, 2026-10-11): a command's round trip to the script stays under 100 ms where
possible. A command needs one request in the normal case (`hello` is cached); an operation that
needs several pieces of data returns them in one reply. Single measurements scatter (14, 24,
43 ms) because the script reads its socket once per display tick; `cmdabl --bridge` reports
min / median / max over 20 round trips. A faster drain is built only if the maximum is above
100 ms. Accepted exception: `arm` asks twice (facts before the write, verify after),
because the SDK reads back `arm` as true for a track Live refuses to arm (measured 2026-10-12).

Rules for every new operation: one handler in `ops/`, one typed function in `bridgeOps.ts`, a
test on each side; described in §4 before it is built, and the script `VERSION` goes up with it;
only selecting and reading until the access token exists.

### 9. Write operations and the access token (confirmed by the user 2026-10-12; built in script 0.5.0)

**Trigger:** `mute` and `solo` on chains and Drum Rack pads in 0.1.0 (`mute kick` → the Kick pad).

**The SDK cannot do it** (checked in the vendored `index.d.mts` / `index.mjs` and `docs/sdk-tree.md`):
`Chain` has `devices`, `mixer`, `insertDevice`, `deleteDevice`, `duplicateDevice`; `DrumChain` adds
`receivingNote`; `ChainMixer` has `volume`, `panning`, `sends` only; the data model has mute/solo
for `Track` and clip `muted` only. So the write goes through the Remote Script (LOM `Chain.mute` /
`Chain.solo`, R/W: "1 = muted (Chain Activator off)").

**Which switch (decided): always the chain**, uniform for every rack type — `chain.mute` /
`chain.solo`, no pad lookup. In a Drum Rack the pad's M/S buttons are `DrumPad.mute` / `solo`;
whether the pad button follows the chain's switch is **unverified** and is the Live test.
**Reference (user, 2026-10-12):** the buttons he wants `mute`/`solo` to switch are the speaker and
`S` buttons of the chain *columns* in the Session mixer when a track's chains are shown (Kick,
Drum1, …) — the chain's own activator (`mute`) and `solo`. The Live test checks that the chain's
column in the mixer shows the change. A
pad-based write (scan `drum_pads` for the pad whose `chains` contain the chain) is a possible later
addition if the chain's switch turns out not to match the visible button.

**Operations**
- `chain_set` `{targets: [{scope, route, expectName, mute?, solo?}, …]}` (chain routes: odd length
  ≥ 3, at most 20, `expectName` required, at least one of `mute`/`solo`, set semantics) →
  `{chains: [{name, mute, solo} | {error: {code, text}}, …]}` read back after the write; `stale` /
  `out_of_range` → exit 1 "the Live Set changed; run the command again" as for `select`; `failed`
  if Live did not apply the change. A writing op: needs the access token.
- `chains` replies carry `mute` / `solo` per chain **only when true** (absent = off, keeps the
  entries small), so modules toggle from read values as for tracks.
- Extension (`src/ableton/bridgeOps.ts`): `chainSwitches(bridge, nodes)` → current
  `{name, mute, solo}` per chain node (one `chains` request for all racks involved, name checked);
  `chainSet(bridge, [{…node, mute?, solo?}])` → `{name, mute, solo}` per chain read back. The
  caller (cmdabl-modules) computes the toggle from `chainSwitches` and writes with `chainSet`.

**Access token** (mandatory before the first operation that changes something — built with the
first one, `chain_set`)
- *Threat model.* Any local process can send UDP to 127.0.0.1:27185. The same user can already
  change a Live Set in other ways, so the token protects against another local user and against
  stray or hostile datagrams — not against the user's own processes.
- *Creation.* The script creates a random token (`secrets.token_hex(16)`) when it starts and
  writes it to `~/Library/Application Support/cmdAbl/bridge-token` (directory `0700`, file `0600`,
  written through a temp file and renamed). New per Live start. **Not** in the script's folder (a
  development install links that folder into the repository) and never in the repo; never logged;
  never in a reply. On another platform the script creates no token and refuses writing ops with
  `forbidden` and a clear text (0.1.0 is macOS-only).
- *Sharing.* The extension reads the file lazily (`src/ableton/bridgeToken.ts`), keeps it in
  memory and sends `token` with every request of a writing op; on `forbidden` it forgets the value,
  re-reads the file once and retries once (a Live restart changes the token). Reads and `select`
  need no token.
- *Checking.* `ops/__init__.py` lists the writing ops in `WRITES`; `protocol.handle_request`
  refuses a writing op without or with a wrong token (`hmac.compare_digest`) with the error code
  `forbidden` **before** any handler runs and removes `token` from the args the handler sees.
- *Files and limits.* The script's side is `access_token.py` (not `token.py`: that name would
  shadow Python's standard `token` module, which `traceback` needs, whenever the folder is on
  `sys.path`). `protocol.handle_request` takes `writes` as a required argument, so a caller
  cannot forget the gate. Two Live instances: the second writes a new token file, the first
  instance's script keeps its own and its writes stay `forbidden` until it restarts (out of
  scope). The script creates a folder and a file in the user's Library at every start and the
  extension reads outside its bundle (the announced stricter sandbox may forbid it: then only
  writing commands answer exit 5) — listed in `docs/sdk-tree.md` §7.
- *Undo.* `chain_set` wraps all its targets in one `song.begin_undo_step()` /
  `end_undo_step()` pair (guarded), so one command is one undo step — if chain mute/solo are
  undoable at all (unverified; Live test: Edit → Undo after `mute` on two pads). More than 20
  targets are several requests, hence several steps. A target with both `mute` and `solo` can end
  half-applied; its entry then carries the error.
- *What the user sees.* `forbidden` → exit 5 "the Remote Script refused the change (access token);
  restart Live or run `cmdabl --setup`"; an unreadable file → exit 5 "cannot read the bridge access
  token; …"; not macOS → exit 5 "changing chains is available on macOS only".
- *Tests.* Script: writing op without / with a wrong / with the right token, no token at all, read
  ops and `select` without token, the token not in a reply or a handler's args, file mode `0600` /
  directory `0700`, no token off macOS or on a failed write, the file not under the script folder.
  Extension: lazy read, cache and forget, unreadable / malformed file, re-read once after
  `forbidden`, no token sent for non-writing requests.
- *Rejected:* a token the extension generates and sends on the first write (trust on first use) —
  a hostile process could win the race at script start.

## Phased rollout

Three shippable increments, each independently testable (mirrors the existing Phase 0/1/2
cadence in the commit history):

- **Phase 2 — addressable tree + path-based selection.** Object tree for tracks/group
  tracks/devices (deliberately *no* chains yet — they don't need the bidirectional bridge).
  Generalized `resolveRef`. Bare-path input selects/reveals any node. Existing fuzzy search
  extended to cover devices.
  - *Ships when*: typing `/vermona/kick` or `/vermona/eq eight` finds and selects the right
    object, including unfolding parent groups as Phase 1's track-select already does.
- **Phase 3 — Linux-style command grammar.** Tokenizer with quote support; flags vs. path
  arguments; `paths` added to `PaletteResult`; `mute`/`solo`/`rm` implemented and dispatched
  directly through the SDK (no bridge), with `-d`/`-c` to disambiguate kind.
  - *Ships when*: `mute /vermona/kick /vermona/snare`, `rm -d /vermona/kick/reverb`, etc. all
    parse, resolve, and apply correctly — including multi-target — and are visible/undoable
    in Live.
- **Phase 4 — bidirectional bridge + chain provider.** Request/response protocol on the UDP
  bridge; capability handshake on connect; the optional chain provider registers only when the
  handshake succeeds; `select` extended to chains (and devices, if not already covered).
  - *Ships when*: with the upgraded Remote Script installed, Drum Rack pads are searchable
    and selectable by name (`/vermona/808/kick`); without it, they're cleanly absent — no
    errors, no stale entries, matching today's "selection silently no-ops without the bridge"
    behavior.

## Verification

Build a test Set containing: a plain track, a group track with several children, a track with
a multi-device chain, and a Drum Rack with custom-named pads. For each phase above, confirm:

- **Phase 2**: fuzzy search surfaces tracks, group children, and devices with correct,
  human-readable paths; bare-path selection unfolds the right groups and reveals devices in
  Live's view (not just changes the model's `selected_track`/`selected_device`).
- **Phase 3**: `mute`/`solo`/`rm` work with and without `-d`/`-c`, singly and multi-target;
  the right objects (and *only* the right objects) are affected, and each operation produces
  a sensible, undoable entry in Live's Edit > Undo History.
- **Phase 4**: the chain provider appears (and pads are findable/selectable by name) only
  with the upgraded Remote Script installed and running; reinstall/restart cycles don't leave
  stale chain entries; uninstalling the script makes chains disappear from search without
  errors in the console.

Run `npm run build` (or the project's typecheck/build step) after each phase, and use the
`run`/`verify` skill to drive the palette in a live Ableton session for the manual checks
above — type-checking proves correctness of the code, not of the feature.
