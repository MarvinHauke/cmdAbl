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
export interface ArmFacts {
  /** One entry per node, in order; undefined when no facts were available. */
  facts: Array<BridgeResult<TrackFacts>> | undefined;
  /** Why there are none (empty when there are). For the log only. */
  reason: string;
}

export async function loadArmFacts(
  bridge: Bridge,
  nodes: Array<Pick<ObjectNode, "scope" | "route" | "name">>,
): Promise<ArmFacts> {
  const none = (reason: string): ArmFacts => ({ facts: undefined, reason });
  if (nodes.length === 0) return none("no tracks");
  try {
    const state = bridge.state();
    if (state === "unavailable") return none("bridge unavailable (cached)");
    if (state === "unknown") {
      const hello = await bridge.available();
      if (!hello.ok) return none(`bridge unavailable (code ${hello.code})`);
    }
    const reply = await trackFacts(bridge, nodes);
    if (!reply.ok) return none(`track_facts failed (code ${reply.code})`);
    if (reply.value.length !== nodes.length) return none("track_facts answered the wrong number of tracks");
    return { facts: reply.value, reason: "" };
  } catch {
    return none("track_facts threw");
  }
}

/** Log lines for what `arm` learned: names and booleans only. */
export function armFactsLines(nodes: Array<Pick<ObjectNode, "path">>, loaded: ArmFacts): string[] {
  const facts = loaded.facts;
  if (!facts) return [`cmdAbl: arm facts: none (${loaded.reason})`];
  return nodes.map((node, i) => {
    const entry = facts[i];
    if (!entry) return `cmdAbl: arm facts: ${node.path} missing`;
    if (!entry.ok) return `cmdAbl: arm facts: ${node.path} failed (code ${entry.code}: ${entry.text})`;
    const f = entry.value;
    return `cmdAbl: arm facts: ${node.path} canBeArmed=${f.canBeArmed} isGroup=${f.isGroup} isGrouped=${f.isGrouped} arm=${f.arm}`;
  });
}

export function armReadBackLine(path: string, wrote: boolean, reads: unknown): string {
  return `cmdAbl: arm: ${path} wrote ${wrote}, reads ${String(reads)}`;
}
