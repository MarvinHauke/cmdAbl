// Every ModuleApi port method and what stands behind it: the SDK call(s) or
// Remote Script operation, and the LOM name of what it represents. One table,
// as data: the generated page docs/reference/live-api.md renders it, and a test
// (portMapping.test.ts) fails when a port method has no entry — so when the SDK
// grows an API that replaces a script operation, the switch touches an adapter
// (src/extension.ts) and this table, not the modules.
//
// `via`:
//   "sdk"      the Extensions SDK
//   "script"   the companion Remote Script (src/ableton/bridgeOps.ts)
//   "platform" cmdAbl itself; nothing in Live is touched

export interface PortMapping {
  /** `bridge.request`, `tracks.track`, `tracks.track().mute` — the port method or property. */
  port: string;
  via: "sdk" | "script" | "platform";
  /** The SDK call(s) or script operation(s) behind it. */
  call: string;
  /** LOM names of what it represents, as `Class.member` (empty: no LOM counterpart). */
  lom: string[];
  /** What a reader needs beyond the names. */
  note?: string;
}

export const PORT_MAPPING: readonly PortMapping[] = [
  // bridge — the Remote Script client
  {
    port: "bridge.available",
    via: "script",
    call: "operation `hello` (cached answer)",
    lom: [],
    note: "The handshake: is the script installed, running and the right protocol version.",
  },
  { port: "bridge.ping", via: "script", call: "operation `hello` (fresh)", lom: [], note: "Used for status and timing." },
  {
    port: "bridge.request",
    via: "script",
    call: "any operation listed in remote-script.md",
    lom: [],
    note: "The LOM properties each operation reads or writes are listed per operation in the Remote Script table below.",
  },
  { port: "bridge.state", via: "platform", call: "the client's last known state", lom: [] },
  { port: "bridge.close", via: "platform", call: "closes the local socket", lom: [] },

  // liveSet — the object tree
  {
    port: "liveSet.nodes",
    via: "sdk",
    call: "`application.song.tracks`, `returnTracks`, `mainTrack`; `track.name`; `track.devices[i].name`",
    lom: ["Song.tracks", "Song.return_tracks", "Song.master_track", "Track.name", "Track.devices", "Device.name"],
    note: "Tracks and devices come from the SDK; chain and drum pad nodes come from the script operation `chains` (the SDK has no chain names yet) — see the script table.",
  },

  // tracks — SDK-backed writes (work without the Remote Script)
  {
    port: "tracks.transaction",
    via: "sdk",
    call: "`context.withinTransaction(fn)`",
    lom: [],
    note: "One undo step for everything written inside. Comparable to the Python API's begin_undo_step / end_undo_step, which the script's chain_set uses; not in the LOM reference. How the SDK builds it is not documented.",
  },
  {
    port: "tracks.track",
    via: "sdk",
    call: "`application.song.tracks[i]` / `returnTracks[i]` / `[mainTrack]` by the node's scope and route",
    lom: ["Song.tracks", "Song.return_tracks", "Song.master_track"],
    note: "Position-based: after a Set change the index may hold another track.",
  },
  { port: "tracks.track().mute", via: "sdk", call: "`track.mute`", lom: ["Track.mute"] },
  { port: "tracks.track().solo", via: "sdk", call: "`track.solo`", lom: ["Track.solo"] },
  {
    port: "tracks.track().arm",
    via: "sdk",
    call: "`track.arm`",
    lom: ["Track.arm"],
    note: "Live refuses some tracks silently; `can_be_armed` and the verification come from the script (operation `track_facts`).",
  },

  // dialog, log and the platform-only ports
  { port: "dialog", via: "sdk", call: "the SDK's modal dialog (`context.ui`, a data: URL page) through the dialog queue", lom: [] },
  { port: "log", via: "platform", call: "`console.log` in the Extension Host", lom: [] },
  { port: "pick", via: "platform", call: "the platform's pick list", lom: [] },
  { port: "confirm", via: "platform", call: "the platform's pick list (Cancel / Confirm rows)", lom: [] },
  { port: "onPick", via: "platform", call: "listener on the pick list", lom: [] },
  { port: "showFeedback", via: "platform", call: "the platform's message dialog", lom: [] },
  { port: "registerProvider", via: "platform", call: "palette item provider", lom: [] },
  { port: "onCommandRun", via: "platform", call: "listener after a command finished", lom: [] },
  { port: "commands.add", via: "platform", call: "declares a node on the command tree", lom: [] },
];

/** The LOM page of a `Class.member` name: https://docs.cycling74.com/apiref/lom/<class>/ (class lowercased, as the reference names its pages). */
export function lomUrl(name: string): string {
  const cls = name.split(".")[0] ?? name;
  return `https://docs.cycling74.com/apiref/lom/${cls.toLowerCase()}/`;
}
