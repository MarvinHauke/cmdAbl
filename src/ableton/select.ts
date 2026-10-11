import type { ObjectNode } from "./objectTree.js";
import { selectDevice, selectTrack } from "./bridge.js";

/** Select a track or device in Live (through the Remote Script — the SDK cannot change selection). */
export function selectNode(node: ObjectNode): void {
  if (node.kind === "track") selectTrack(node.scope, node.route[0]!);
  else selectDevice(node.scope, node.route[0]!, node.route[1]!);
}
