import * as dgram from "node:dgram";
import type { TrackScope } from "../types.js";
import { createBridgeClient, createUdpTransport, type Bridge } from "./bridgeClient.js";
import { inspectInstalledScript } from "./installedScript.js";

// The Extensions SDK can't change Live's selection, so cmdAbl talks to its
// companion Remote Script over a local UDP socket (see remote-script/cmdAbl).
// Fire-and-forget: if the Remote Script isn't installed/enabled, the datagram
// is simply dropped and selection silently no-ops.

const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PORT = 27185;

function send(payload: Record<string, unknown>): void {
  const client = dgram.createSocket("udp4");
  client.on("error", () => client.close());
  client.send(Buffer.from(JSON.stringify(payload)), BRIDGE_PORT, BRIDGE_HOST, () => {
    client.close();
  });
}

/**
 * Ask the Remote Script to select the track at `index` within the named
 * collection (song.tracks / .return_tracks / .master_track — see TrackScope).
 */
export function selectTrack(scope: TrackScope, index: number): void {
  send({ cmd: "select_track", scope, index });
}

/** Ask the Remote Script to select and reveal a device on a track in the named collection. */
export function selectDevice(scope: TrackScope, trackIndex: number, deviceIndex: number): void {
  send({ cmd: "select_device", scope, trackIndex, deviceIndex });
}

/**
 * The request/response bridge (protocol with replies — see bridgeClient.ts).
 * One shared client per Extension Host; modules take it through a port and
 * tests use createFakeBridge. The legacy fire-and-forget functions above stay
 * until `select` moves to the new protocol (build step 2).
 */
let shared: Bridge | null = null;
export function getBridge(): Bridge {
  if (!shared) {
    shared = createBridgeClient({ transport: createUdpTransport(), installed: () => inspectInstalledScript() });
  }
  return shared;
}
