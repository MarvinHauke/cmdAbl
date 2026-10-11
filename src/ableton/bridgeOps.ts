import type { Bridge } from "./bridgeClient.js";
import { fail, TEXT_STALE, type BridgeResult } from "./bridgeProtocol.js";
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

/** What the SDK cannot tell about one track (0001 §4). */
export interface TrackFacts {
  /** The track's name in Live right now. */
  name: string;
  /** False for return and main tracks and for tracks Live greys out (e.g. a MIDI track without an input device). */
  canBeArmed: boolean;
  /** True for group tracks. */
  isGroup: boolean;
  /** True when the track sits inside a group. */
  isGrouped: boolean;
  /** The arm state; null when the track cannot be armed (the LOM refuses the read). */
  arm: boolean | null;
}

/** At most this many tracks go into one request (the reply must fit one datagram). */
export const TRACK_FACTS_PER_REQUEST = 20;
/** …and the encoded targets stay under this many bytes (requests stay under 2 KB, 0001 §1). */
export const REQUEST_BYTES_BUDGET = 2000;

function parseFacts(entry: unknown, askedName: string): BridgeResult<TrackFacts> {
  const e = entry as Record<string, unknown> | null;
  if (typeof e !== "object" || e === null) return fail(1, "bad reply from the Remote Script: track_facts entry");
  const err = e.error as Record<string, unknown> | undefined;
  if (err && typeof err === "object") {
    const text = typeof err.text === "string" ? err.text : "track_facts failed";
    // stale / out_of_range: the Set changed (exit code 1, 0001 §2); anything else is a failure too.
    return fail(1, err.code === "stale" || err.code === "out_of_range" ? TEXT_STALE : `Remote Script: ${text}`);
  }
  // The script leaves `name` out when the name asked for matched.
  const name = e.name === undefined ? askedName : e.name;
  if (
    typeof name !== "string" ||
    typeof e.can_be_armed !== "boolean" ||
    typeof e.is_foldable !== "boolean" ||
    typeof e.is_grouped !== "boolean" ||
    !(typeof e.arm === "boolean" || e.arm === null)
  ) {
    return fail(1, "bad reply from the Remote Script: track_facts entry");
  }
  return { ok: true, value: { name, canBeArmed: e.can_be_armed, isGroup: e.is_foldable, isGrouped: e.is_grouped, arm: e.arm } };
}

/**
 * Split by count and by encoded size, so a long or non-ASCII name cannot push a request over the
 * cap. A single name longer than the budget still goes out as one oversized request (not a real case).
 */
export function chunkTargets<T extends Pick<ObjectNode, "scope" | "route" | "name">>(nodes: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const node of nodes) {
    const size = Buffer.byteLength(JSON.stringify({ scope: node.scope, route: node.route, expectName: node.name }), "utf8") + 1;
    if (current.length > 0 && (current.length >= TRACK_FACTS_PER_REQUEST || bytes + size > REQUEST_BYTES_BUDGET)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(node);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Facts for one or several tracks. One request per `TRACK_FACTS_PER_REQUEST`
 * tracks (one in the normal case). The outer result is the transport/script
 * outcome; each entry answers its own track, in the order given, so one stale
 * track does not hide the others. Never throws.
 */
export async function trackFacts(
  bridge: Bridge,
  nodes: Array<Pick<ObjectNode, "scope" | "route" | "name">>,
): Promise<BridgeResult<Array<BridgeResult<TrackFacts>>>> {
  const out: Array<BridgeResult<TrackFacts>> = [];
  for (const chunk of chunkTargets(nodes)) {
    const targets = chunk.map((n) => ({ scope: n.scope, route: n.route, expectName: n.name }));
    const reply = await bridge.request("track_facts", { targets });
    if (!reply.ok) return reply;
    const tracks = reply.value.tracks;
    if (!Array.isArray(tracks) || tracks.length !== chunk.length) {
      return fail(1, "bad reply from the Remote Script: track_facts without one entry per track");
    }
    tracks.forEach((entry, k) => out.push(parseFacts(entry, chunk[k]!.name)));
  }
  return { ok: true, value: out };
}
