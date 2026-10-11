import type { Bridge } from "../ableton/bridgeClient.js";
import { trackFacts, type TrackFacts } from "../ableton/bridgeOps.js";
import type { BridgeResult } from "../ableton/bridgeProtocol.js";
import type { ObjectNode } from "../ableton/objectTree.js";

/**
 * What Live says about each track `arm` is about to write, one entry per node
 * in order — or undefined when the facts are not available (no script, an
 * outdated one, no answer), in which case `arm` behaves as it does without the
 * Remote Script. `arm` does not require the bridge, so this must not add a wait
 * to every call: a cached "unavailable" skips the request; only an unknown
 * state asks once (the answer is cached by the client).
 */
export async function loadArmFacts(
  bridge: Bridge,
  nodes: Array<Pick<ObjectNode, "scope" | "route" | "name">>,
): Promise<Array<BridgeResult<TrackFacts>> | undefined> {
  if (nodes.length === 0) return undefined;
  try {
    const state = bridge.state();
    if (state === "unavailable") return undefined;
    if (state === "unknown") {
      const hello = await bridge.available();
      if (!hello.ok) return undefined;
    }
    const reply = await trackFacts(bridge, nodes);
    return reply.ok && reply.value.length === nodes.length ? reply.value : undefined;
  } catch {
    return undefined;
  }
}
