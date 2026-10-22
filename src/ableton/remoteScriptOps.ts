// The Remote Script's operations as data, for the generated reference pages
// (docs/reference/remote-script.md, live-api.md). Hand-written next to the Python
// table (remote-script/cmdAbl/ops/__init__.py); remoteScriptOps.test.ts fails when
// the two drift apart, and when the Python sources touch a LOM property that is not
// declared here (or this table declares one the sources no longer use).
//
// LOM names and types follow https://docs.cycling74.com/apiref/lom/ (Live 12.4.5),
// one page per object at /apiref/lom/<page>/. Checked 2026-10-12.

export type LomAccess = "get" | "set" | "call";

/** One LOM property or function the script touches. */
export interface LomUse {
  /** LOM object as the reference names it: "Track", "Track.View", "Song.View", "RackDevice.View", "Chain", "DrumChain", "Device", "RackDevice", "Song". */
  object: string;
  /** Property, child or function name. */
  property: string;
  access: LomAccess;
  /** Reference page slug: https://docs.cycling74.com/apiref/lom/<page>/ */
  page: string;
  /** The type the reference states ("bool", "int", "Track", "list of Chain", …). */
  type: string;
  /** False when the reference does not document the member at all (it exists in the Python API, which the script uses). */
  documented: boolean;
  /** Restriction or caveat, from the reference or verified in Live. */
  note?: string;
}

/** A field on the wire or in the extension that is named differently from the LOM property behind it. */
export interface FieldMapping {
  /** Wire name in the script's request/reply. */
  wire: string;
  /** Extension-side name (bridgeOps.ts), when it differs from the wire name. */
  ts?: string;
  /** "Object.property" in LOM notation. */
  lom: string;
}

export interface RemoteScriptOp {
  name: string;
  /** One sentence: what the operation does. */
  summary: string;
  /** The `args` object, in short form; omitted when there are none. */
  params?: string;
  /** True for operations that change or delete something in the Live Set (they need the access token and `expectName`); selection and view changes are not counted. */
  changesLive: boolean;
  /** How the operation reaches Live: always the Remote Script here; the SDK-backed ports are listed by cmdabl-core. */
  via: "script";
  /** The LOM members the operation itself uses (navigation through the route is in REMOTE_SCRIPT_ROUTE_LOM). */
  lom: readonly LomUse[];
  /** True when the operation walks `{scope, route}`: it then also uses REMOTE_SCRIPT_ROUTE_LOM. */
  usesRoute: boolean;
  fields?: readonly FieldMapping[];
  /** What an SDK call could replace the script with, or "none yet". */
  sdkAlternative: string;
}

const T = (property: string, access: LomAccess, type: string, note?: string): LomUse => ({
  object: "Track", property, access, page: "track", type, documented: true, ...(note ? { note } : {}),
});
const lom = (object: string, page: string, property: string, access: LomAccess, type: string, note?: string, documented = true): LomUse => ({
  object, property, access, page, type, documented, ...(note ? { note } : {}),
});

/** Walking `{scope, route}` (routes.py): used by every operation that takes a route. */
export const REMOTE_SCRIPT_ROUTE_LOM: readonly LomUse[] = [
  lom("Song", "song", "tracks", "get", "list of Track"),
  lom("Song", "song", "return_tracks", "get", "list of Track"),
  lom("Song", "song", "master_track", "get", "Track"),
  lom("Track", "track", "devices", "get", "list of Device", "includes the mixer device per the reference"),
  lom("Chain", "chain", "devices", "get", "list of Device"),
  lom("RackDevice", "rackdevice", "chains", "get", "list of Chain"),
];

export const REMOTE_SCRIPT_OPS: readonly RemoteScriptOp[] = [
  {
    name: "hello",
    summary: "Reports the script version, the protocol version and the supported operations; answered for any protocol version.",
    changesLive: false,
    via: "script",
    lom: [],
    usesRoute: false,
    sdkAlternative: "none (this is the bridge's own handshake)",
  },
  {
    name: "select",
    summary:
      "Selects a track, device, chain or drum pad in Live's views, after checking that the object at the route still has the expected name; optionally shows the rack's chains. Changes the selection and the view only; needs no token.",
    params: "{ scope, route, expectName, showChains? }",
    changesLive: false,
    via: "script",
    usesRoute: true,
    lom: [
      lom("Song", "song", "view", "get", "Song.View"),
      lom("Song.View", "song_view", "selected_track", "set", "Track", "getsetobserve"),
      lom("Song.View", "song_view", "selected_track", "get", "Track", "read back with != (wrappers, never `is`)"),
      lom("Song.View", "song_view", "select_device", "call", "function(device)", "the track is not shown automatically; the device becomes the appointed device only if its track is selected"),
      lom("Track", "track", "view", "get", "Track.View"),
      lom("Track.View", "track_view", "selected_device", "get", "Device", "get, observe: read back after select_device"),
      lom("Device", "device", "view", "get", "Device.View", "RackDevice.View for racks"),
      lom("RackDevice.View", "rackdevice_view", "selected_chain", "set", "Chain", "getsetobserve; selects the chain in the rack, also Drum Rack pads' chains"),
      lom("RackDevice.View", "rackdevice_view", "selected_chain", "get", "Chain"),
      lom("Track", "track", "name", "get", "symbol", "the identity check against expectName (Device.name / Chain.name likewise)"),
      lom("Device", "device", "name", "get", "symbol"),
      lom("Chain", "chain", "name", "get", "unicode"),
      T("group_track", "get", "Track", "None when the track is not grouped (the Max reference says id 0)"),
      T("is_foldable", "get", "bool", "reference: Instrument and Drum Racks return 0 even though they can open and close; group tracks are 1"),
      T("fold_state", "get", "int", "only available if is_foldable = 1"),
      T("fold_state", "set", "int", "0 unfolds a collapsed parent group so the object is visible"),
      T("can_show_chains", "get", "bool"),
      T("is_showing_chains", "get", "bool"),
      T("is_showing_chains", "set", "bool", "set to true only, never folds; to confirm in Live for Drum Rack tracks"),
    ],
    fields: [{ wire: "is_showing_chains", ts: "isShowingChains", lom: "Track.is_showing_chains" }],
    sdkAlternative: "none yet (the SDK has no selection or view access)",
  },
  {
    name: "track_facts",
    summary: "Reads what the SDK cannot: whether a track can be armed, is a group or is grouped, and its arm state (up to 20 tracks per request).",
    params: "{ targets: [{ scope, route, expectName? }] }",
    changesLive: false,
    via: "script",
    usesRoute: true,
    lom: [
      T("can_be_armed", "get", "bool", "reference: 0 for return and master tracks; verified in Live: also true for a MIDI track whose input device is unavailable"),
      T("arm", "get", "bool", "not in return/master tracks; read only when can_be_armed; the SDK's read of arm was wrong in Live"),
      T("is_foldable", "get", "bool", "reference: Instrument and Drum Racks return 0; group tracks are 1"),
      T("is_grouped", "get", "bool"),
      T("name", "get", "symbol", "returned only when no expectName was given"),
    ],
    fields: [
      { wire: "is_foldable", ts: "isFoldable", lom: "Track.is_foldable" },
      { wire: "is_grouped", ts: "isGrouped", lom: "Track.is_grouped" },
      { wire: "can_be_armed", ts: "canBeArmed", lom: "Track.can_be_armed" },
      { wire: "arm", lom: "Track.arm" },
    ],
    sdkAlternative: "partly: the SDK has Track.arm (its read was wrong in Live) and groupTrack (gives isGrouped only); nothing for is_foldable or can_be_armed",
  },
  {
    name: "chains",
    summary: "Reads the chain names of racks (and drum pad notes, mute and solo), paged by size (up to 20 racks per request).",
    params: "{ targets: [{ scope, route, offset? }] }",
    changesLive: false,
    via: "script",
    usesRoute: true,
    lom: [
      lom("Chain", "chain", "name", "get", "unicode", "the SDK's Chain has no name"),
      lom("Chain", "chain", "mute", "get", "bool", "1 = muted (Chain Activator off)"),
      lom("Chain", "chain", "solo", "get", "bool", "1 = soloed"),
      lom("DrumChain", "drumchain", "in_note", "get", "int", "available since Live 12.3; -1 = All Notes; unverified in Live"),
      lom("Device", "device", "can_have_drum_pads", "get", "bool", "1 for Drum Racks; always readable"),
      lom("RackDevice", "rackdevice", "has_drum_pads", "get", "bool", "only available for Drum Racks (raises elsewhere): read after can_have_drum_pads"),
    ],
    fields: [
      { wire: "kind", lom: "Device.can_have_drum_pads and RackDevice.has_drum_pads" },
      { wire: "in_note", ts: "notes", lom: "DrumChain.in_note" },
      { wire: "total", lom: "RackDevice.chains (length)" },
    ],
    sdkAlternative: "none yet (SDK Chain has no name; DrumChain.receivingNote may cover in_note)",
  },
  {
    name: "chain_set",
    summary: "Mutes or solos chains, checked by name and read back afterwards (up to 20 chains per request; one undo step).",
    params: "{ targets: [{ scope, route, expectName, mute?, solo? }], token }",
    changesLive: true,
    via: "script",
    usesRoute: true,
    lom: [
      lom("Chain", "chain", "name", "get", "unicode", "the identity check against expectName"),
      lom("Chain", "chain", "mute", "get", "bool", "read back after the write"),
      lom("Chain", "chain", "mute", "set", "bool", "1 = muted (Chain Activator off)"),
      lom("Chain", "chain", "solo", "get", "bool", "read back after the write"),
      lom("Chain", "chain", "solo", "set", "bool", "does not turn Solo off in other chains"),
      lom("Song", "song", "begin_undo_step", "call", "function()", "not in the reference's Song page (it lists undo/redo only); guarded, one undo step per command", false),
      lom("Song", "song", "end_undo_step", "call", "function()", "not in the reference's Song page; guarded", false),
    ],
    sdkAlternative: "none yet (the SDK's Chain has no mute or solo)",
  },
  {
    name: "param_display",
    summary: "Reads Live's own display text (\"-6.0 dB\", \"-inf dB\") for values of a track's volume, without moving the fader; at most 64 values per call.",
    params: "{ scope, route, param: \"volume\", values: number[], expectName? }",
    changesLive: false,
    via: "script",
    usesRoute: true,
    lom: [
      lom("Track", "track", "mixer_device", "get", "MixerDevice"),
      lom("MixerDevice", "mixerdevice", "volume", "get", "DeviceParameter"),
      lom("DeviceParameter", "deviceparameter", "min", "get", "float", "values outside min..max are refused"),
      lom("DeviceParameter", "deviceparameter", "max", "get", "float"),
      lom("DeviceParameter", "deviceparameter", "str_for_value", "call", "function(value)", "returns the display text for a value; does not change the parameter"),
    ],
    sdkAlternative: "none (the SDK's mixer.volume is a number 0..1 with no display text)",
  },
  {
    name: "set_id",
    summary: "Reads the Live Set's own id (null when it has none); with create it stores a new random id in the Set and marks the Set as modified with the invisible colour toggle of tags_set.",
    params: "{ create?: bool, token }",
    changesLive: true,
    via: "script",
    usesRoute: false,
    lom: [
      lom("Song", "song", "get_data", "call", "function(key, default)", "Python API only: not in the Cycling '74 reference; key \"cmdabl.set-id\", a 32-character hex string; anything else counts as no id", false),
      lom("Song", "song", "set_data", "call", "function(key, value)", "only with create and no id yet; read back after the write; survives save, reload, Save As and Collect All and Save (Live-tested 2026-10-22)", false),
      lom("Track", "track", "color_index", "get", "int", "the colour toggle that marks the Set as modified (as in tags_set)"),
      lom("Track", "track", "color_index", "set", "int", "changed to a neighbour and put back inside one undo step"),
      lom("Song", "song", "begin_undo_step", "call", "function()", "groups the colour toggle into one step; not in the reference's Song page", false),
      lom("Song", "song", "end_undo_step", "call", "function()", "see begin_undo_step", false),
    ],
    fields: [{ wire: "id", lom: "Song.get_data(\"cmdabl.set-id\")" }],
    sdkAlternative: "none (the SDK has no Set data store)",
  },
  {
    name: "tags_all",
    summary: "Reads the tags of every tagged track (regular, return, main); stored on the track with Track.get_data, so they live in the Set.",
    params: "{ offset? }",
    changesLive: false,
    via: "script",
    usesRoute: false,
    lom: [
      lom("Track", "track", "get_data", "call", "function(key, default)", "Python API only: not in the Cycling '74 reference (Song and Track have it, Chain/DrumPad/Device do not); key \"cmdabl.tags\", a JSON list of strings; anything else counts as no tags", false),
      lom("Track", "track", "name", "get", "symbol", "the identity check on the extension side: tags belong to a track only while its name matches"),
    ],
    fields: [{ wire: "tags", lom: "Track.get_data(\"cmdabl.tags\")" }],
    sdkAlternative: "none (the SDK has no track data store)",
  },
  {
    name: "tags_set",
    summary: "Replaces the tags of one track and marks the Set as modified with an invisible colour toggle (one undo step), checked by name and read back.",
    params: "{ scope, route, expectName, tags: string[], token }",
    changesLive: true,
    via: "script",
    usesRoute: true,
    lom: [
      lom("Track", "track", "set_data", "call", "function(key, value)", "saved with the Set and copied by a duplicated track (Live-verified), but it neither marks the Set modified nor adds an undo step", false),
      lom("Track", "track", "get_data", "call", "function(key, default)", "read back after the write", false),
      lom("Track", "track", "color_index", "get", "int", "the colour toggle: read first"),
      lom("Track", "track", "color_index", "set", "int", "changed to a neighbour and put back inside one undo step: the only way found to make Live ask to save (Live-verified)"),
      lom("Song", "song", "begin_undo_step", "call", "function()", "groups the colour toggle into one step (shows as \"Custom Action\"); not in the reference's Song page", false),
      lom("Song", "song", "end_undo_step", "call", "function()", "see begin_undo_step", false),
    ],
    sdkAlternative: "none",
  },
];
