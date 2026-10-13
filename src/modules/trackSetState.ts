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
  /** The bridge part gets this long; the platform's cap for `read` is 600 ms. */
  budgetMs = BRIDGE_BUDGET_MS,
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
      // The SDK's values first, so a slow or missing script still leaves them.
      for (const index of trackIdx) states[index] = sdk(index);
      const loaded = await within(loadArmFacts(api.bridge, trackIdx.map((i) => nodes[i]!)), budgetMs);
      if (loaded?.facts) {
        trackIdx.forEach((index, k) => {
          const entry = loaded.facts![k];
          if (entry?.ok) states[index] = entry.value.arm ?? false; // null = cannot be armed = not armed
          else states[index] = null; // the Set changed under this entry
        });
      }
    } else {
      for (const index of trackIdx) states[index] = sdk(index);
    }

    if (chainIdx.length > 0) {
      const chainNodes = chainIdx.map((i) => nodes[i]!);
      const reply = await within(
        bridgeReady(api.bridge).then((ready) => (ready ? chainSwitches(api.bridge, chainNodes) : null)),
        budgetMs,
      );
      if (reply?.ok) {
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

/** Long enough for a round trip (~50 ms), short enough to stay under the platform's 600 ms cap. */
export const BRIDGE_BUDGET_MS = 400;

/** The promise's value, or null when it takes longer than `ms` (the rows then stay unknown). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, slow]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The cached-state rule of `loadArmFacts`: a known-missing script is not asked, an unknown one once. */
async function bridgeReady(bridge: Bridge): Promise<boolean> {
  const state = bridge.state();
  if (state === "unavailable") return false;
  if (state === "available") return true;
  return (await bridge.available()).ok;
}
