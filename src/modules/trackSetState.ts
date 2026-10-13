import type { Bridge } from "../ableton/bridgeClient.js";
import { chainSwitches } from "../ableton/bridgeOps.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { loadArmFacts } from "./armFacts.js";
import type { ModuleApi } from "./types.js";

/**
 * Whether each candidate of a pick list is already muted / soloed / armed
 * (`pickState` of mute, solo and arm), in candidate order: true = on,
 * false = off, null = unknown. Never throws: a source that fails gives nulls.
 *
 * - tracks: the SDK port (no Remote Script needed); for `arm`, the script's
 *   `track_facts` when the bridge is reachable, because the SDK reads `arm`
 *   wrongly for a track Live refused to arm;
 * - chains and pads (mute, solo): one `chains` request for all of them, only
 *   when the bridge is reachable — a missing script costs no wait.
 */
export async function readSwitchStates(
  api: Pick<ModuleApi, "bridge" | "tracks">,
  prop: "mute" | "solo" | "arm",
  nodes: ObjectNode[],
): Promise<Array<boolean | null>> {
  const states: Array<boolean | null> = nodes.map(() => null);
  const trackIdx = nodes.flatMap((n, i) => (n.kind === "track" ? [i] : []));
  const chainIdx = prop === "arm" ? [] : nodes.flatMap((n, i) => (n.kind === "chain" ? [i] : []));

  try {
    const sdk = (index: number): boolean | null => {
      try {
        const handle = api.tracks.track(nodes[index]!);
        return handle ? handle[prop] : null;
      } catch {
        return null;
      }
    };

    if (prop === "arm" && trackIdx.length > 0) {
      const loaded = await loadArmFacts(api.bridge, trackIdx.map((i) => nodes[i]!));
      trackIdx.forEach((index, k) => {
        const entry = loaded.facts?.[k];
        if (!loaded.facts) states[index] = sdk(index); // no script: the SDK's value
        else if (entry?.ok) states[index] = entry.value.arm ?? false; // null = cannot be armed = not armed
        else states[index] = null; // the Set changed under this entry
      });
    } else {
      for (const index of trackIdx) states[index] = sdk(index);
    }

    if (chainIdx.length > 0 && (await bridgeReady(api.bridge))) {
      const reply = await chainSwitches(api.bridge, chainIdx.map((i) => nodes[i]!));
      if (reply.ok) {
        chainIdx.forEach((index, k) => {
          const entry = reply.value[k];
          states[index] = entry?.ok ? entry.value[prop as "mute" | "solo"] : null;
        });
      }
    }
  } catch {
    // a failed source leaves its rows unknown
  }
  return states;
}

/** The cached-state rule of `loadArmFacts`: a known-missing script is not asked, an unknown one once. */
async function bridgeReady(bridge: Bridge): Promise<boolean> {
  const state = bridge.state();
  if (state === "unavailable") return false;
  if (state === "available") return true;
  return (await bridge.available()).ok;
}
