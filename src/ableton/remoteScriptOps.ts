// The Remote Script's operations as data, for the generated reference
// (docs/reference/remote-script.md). Hand-written next to the Python table
// (remote-script/cmdAbl/ops/__init__.py); remoteScriptOps.test.ts fails when the
// two drift apart, so an op added in Python must be described here too.

export interface RemoteScriptOp {
  name: string;
  /** One sentence: what the operation does. */
  summary: string;
  /** The `args` object, in short form; omitted when there are none. */
  params?: string;
  /** True for operations that change or delete something in the Live Set (they need the access token and `expectName`); selection and view changes are not counted. */
  changesLive: boolean;
}

export const REMOTE_SCRIPT_OPS: readonly RemoteScriptOp[] = [
  {
    name: "hello",
    summary: "Reports the script version, the protocol version and the supported operations; answered for any protocol version.",
    changesLive: false,
  },
  {
    name: "select",
    summary:
      "Selects a track, device, chain or drum pad in Live's views, after checking that the object at the route still has the expected name; optionally shows the rack's chains. Changes the selection and the view only; needs no token.",
    params: "{ scope, route, expectName, showChains? }",
    changesLive: false,
  },
  {
    name: "track_facts",
    summary: "Reads what the SDK cannot: whether a track can be armed, is a group or is grouped, and its arm state (up to 20 tracks per request).",
    params: "{ targets: [{ scope, route, expectName? }] }",
    changesLive: false,
  },
  {
    name: "chains",
    summary: "Reads the chain names of racks (and drum pad notes, mute and solo), paged by size (up to 20 racks per request).",
    params: "{ targets: [{ scope, route, offset? }] }",
    changesLive: false,
  },
  {
    name: "chain_set",
    summary: "Mutes or solos chains, checked by name and read back afterwards (up to 20 chains per request; one undo step).",
    params: "{ targets: [{ scope, route, expectName, mute?, solo? }], token }",
    changesLive: true,
  },
];
