import type { Bridge } from "../ableton/bridgeClient.js";
import { trackFacts, type TrackFacts } from "../ableton/bridgeOps.js";
import type { BridgeResult } from "../ableton/bridgeProtocol.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { ARM_DISABLED_HINT } from "./trackSetValue.js";

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
  if (!facts) return [`arm facts: none (${loaded.reason})`];
  return nodes.map((node, i) => {
    const entry = facts[i];
    if (!entry) return `arm facts: ${node.path} missing`;
    if (!entry.ok) return `arm facts: ${node.path} failed (code ${entry.code}: ${entry.text})`;
    const f = entry.value;
    return `arm facts: ${node.path} canBeArmed=${f.canBeArmed} isFoldable=${f.isFoldable} isGrouped=${f.isGrouped} arm=${f.arm}`;
  });
}

export function armReadBackLine(path: string, wrote: boolean, reads: unknown): string {
  return `arm: ${path} wrote ${wrote}, reads ${String(reads)}`;
}

// ── verify after the write ──────────────────────────────────────────────────
// The SDK's `arm` can say "armed" for a track Live refused to arm (a MIDI
// track whose input device is missing: the button is greyed out). The script
// reads the LOM, which is right. After the write it is asked once more for the
// written tracks. The write reaches Live before the script's reply (the request
// is handled on Live's next tick); should a normal track still read its old
// value, one second look after a short pause decides — so a slow tick is never
// reported as a failure.

export interface ArmWrite {
  node: Pick<ObjectNode, "scope" | "route" | "name" | "path">;
  wanted: boolean;
}

export interface ArmVerdict {
  /** ok: the script reads what was written; mismatch: it does not; unknown: no answer for this track. */
  state: "ok" | "mismatch" | "unknown";
  /** What the script reads (null cannot be armed, counted as off); undefined when unknown. */
  actual?: boolean;
  /** True when the first look mismatched and a second look decided (evidence for the 100 ms pause). */
  secondLook?: boolean;
}

/** The current value a toggle starts from: the script's, when it has one, else the SDK's. */
export function armBase(sdkValue: boolean, entry: BridgeResult<TrackFacts> | undefined): boolean {
  if (entry?.ok && entry.value.arm !== null) return entry.value.arm;
  return sdkValue;
}

export function classifyArm(wanted: boolean, entry: BridgeResult<TrackFacts> | undefined): ArmVerdict {
  if (!entry || !entry.ok) return { state: "unknown" };
  const actual = entry.value.arm ?? false;
  return { state: actual === wanted ? "ok" : "mismatch", actual };
}

export async function verifyArmWrites(
  bridge: Bridge,
  writes: ArmWrite[],
  options: { sleep?: (ms: number) => Promise<void>; delayMs?: number } = {},
): Promise<ArmVerdict[]> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const unknown = writes.map((): ArmVerdict => ({ state: "unknown" }));
  if (writes.length === 0) return [];
  const ask = async (indices: number[]): Promise<Array<BridgeResult<TrackFacts>> | undefined> => {
    try {
      const reply = await trackFacts(bridge, indices.map((i) => writes[i]!.node));
      return reply.ok && reply.value.length === indices.length ? reply.value : undefined;
    } catch {
      return undefined;
    }
  };
  const all = writes.map((_, i) => i);
  const first = await ask(all);
  if (!first) return unknown;
  const verdicts = writes.map((w, i) => classifyArm(w.wanted, first[i]));
  const again = all.filter((i) => verdicts[i]!.state === "mismatch");
  if (again.length > 0) {
    await sleep(options.delayMs ?? 100);
    const second = await ask(again);
    if (second) again.forEach((i, k) => (verdicts[i] = { ...classifyArm(writes[i]!.wanted, second[k]), secondLook: true }));
  }
  return verdicts;
}

export function armVerifyLine(path: string, wanted: boolean, verdict: ArmVerdict): string {
  return `arm verify: ${path} wanted ${wanted}, script reads ${verdict.actual ?? "?"} -> ${verdict.state}${verdict.secondLook ? " (first look mismatched, second look decided)" : ""}`;
}

export function armNotChangedText(wanted: boolean): string {
  return wanted
    ? `Live did not arm it: ${ARM_DISABLED_HINT}`
    : "Live did not disarm it";
}
