import * as dgram from "node:dgram";

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

/** Ask the Remote Script to select the track at the given index in song.tracks. */
export function selectTrack(index: number): void {
  send({ cmd: "select_track", index });
}
