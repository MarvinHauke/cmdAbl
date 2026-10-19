import type { Bridge } from "../ableton/bridgeClient.js";
import { chainSet, chainSwitches } from "../ableton/bridgeOps.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import type { ExitCodeValue } from "../core/types.js";
import { nextTrackValue, type TrackSetValue } from "./trackSetValue.js";

/** What happened to one chain; code and message are the bridge's, unchanged. */
export interface ChainOutcome {
  ok: boolean;
  code?: ExitCodeValue;
  message?: string;
}

type ChainNode = Pick<ObjectNode, "scope" | "route" | "name">;

/**
 * Mute or solo chains (rack chains and Drum Rack pads) through the Remote
 * Script — the SDK cannot. A toggle reads the chains' current switches first
 * and writes the negated value (set semantics, so a re-run from history means
 * the same thing for `--set 0`); every chain answers on its own, in the
 * order given. A failure of the bridge as a whole fails every chain with its
 * code and text. Never throws.
 */
export async function setChainSwitch(
  bridge: Bridge,
  nodes: ChainNode[],
  prop: "mute" | "solo",
  value: TrackSetValue,
): Promise<ChainOutcome[]> {
  if (nodes.length === 0) return [];
  const results: ChainOutcome[] = nodes.map(() => ({ ok: true }));
  const failAll = (code: ExitCodeValue, message: string): ChainOutcome[] => nodes.map(() => ({ ok: false, code, message }));
  try {
    const wanted: boolean[] = nodes.map(() => (value === "toggle" ? false : value));
    if (value === "toggle") {
      const current = await chainSwitches(bridge, nodes);
      if (!current.ok) return failAll(current.code, current.text);
      current.value.forEach((entry, i) => {
        if (!entry.ok) results[i] = { ok: false, code: entry.code, message: entry.text };
        else wanted[i] = nextTrackValue(entry.value[prop], "toggle");
      });
    }
    const writeIdx = nodes.map((_, i) => i).filter((i) => results[i]!.ok);
    if (writeIdx.length === 0) return results;
    const reply = await chainSet(
      bridge,
      writeIdx.map((i) => ({ ...nodes[i]!, [prop]: wanted[i]! })),
    );
    if (!reply.ok) {
      for (const i of writeIdx) results[i] = { ok: false, code: reply.code, message: reply.text };
      return results;
    }
    writeIdx.forEach((i, k) => {
      const entry = reply.value[k];
      if (!entry) results[i] = { ok: false, message: "no answer for this chain" };
      else if (!entry.ok) results[i] = { ok: false, code: entry.code, message: entry.text };
      else if (entry.value[prop] !== wanted[i]) results[i] = { ok: false, message: "did not change" };
    });
    return results;
  } catch (e: unknown) {
    return failAll(1, e instanceof Error ? e.message : String(e));
  }
}
