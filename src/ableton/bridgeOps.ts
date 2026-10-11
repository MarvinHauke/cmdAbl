import type { Bridge } from "./bridgeClient.js";
import { fail, type BridgeResult } from "./bridgeProtocol.js";
import type { ObjectNode } from "./objectTree.js";

// One typed function per Remote Script operation (0001 §4, §8). Modules call
// these, never `bridge.request("name", …)` with loose arguments. Every function
// validates the reply shape and never throws.

/** What Live reports as selected after `select`. */
export interface SelectResult {
  name: string;
}

/**
 * Select a node in Live and read it back. The script compares the node's name
 * with what it finds at the route and refuses with exit code 1 ("the Live Set
 * changed; run the command again") when they differ.
 */
export async function select(bridge: Bridge, node: Pick<ObjectNode, "scope" | "route" | "name">): Promise<BridgeResult<SelectResult>> {
  const reply = await bridge.request("select", { scope: node.scope, route: node.route, expectName: node.name }, { changes: true });
  if (!reply.ok) return reply;
  const name = reply.value.name;
  if (typeof name !== "string") return fail(1, "bad reply from the Remote Script: select without a name");
  return { ok: true, value: { name } };
}
