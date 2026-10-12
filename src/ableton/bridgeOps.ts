import type { Bridge } from "./bridgeClient.js";
import { fail, TEXT_STALE, type BridgeResult } from "./bridgeProtocol.js";
import type { ObjectNode } from "./objectTree.js";

// One typed function per Remote Script operation (0001 §4, §8). Modules call
// these, never `bridge.request("name", …)` with loose arguments. Every function
// validates the reply shape and never throws.

/** What Live reports as selected after `select`. */
export interface SelectResult {
  name: string;
  /**
   * Only meaningful when `showChains` was asked for: true = the track's chains are shown in the
   * Session mixer (now or already), false = the write did not take, null = the track cannot show
   * chains (or it was not asked for). `null` therefore means "nothing to report": it also covers a
   * failed read/write and a script that lacks the `showChains` argument (it ignores it).
   */
  chainsShown: boolean | null;
}

export interface SelectOptions {
  /** Also show the track's chains in the Session mixer; never folds anything. Default false. */
  showChains?: boolean;
}

/**
 * Select a node in Live and read it back. The script compares the node's name
 * with what it finds at the route and refuses with exit code 1 ("the Live Set
 * changed; run the command again") when they differ.
 */
export async function select(
  bridge: Bridge,
  node: Pick<ObjectNode, "scope" | "route" | "name">,
  options: SelectOptions = {},
): Promise<BridgeResult<SelectResult>> {
  const args: Record<string, unknown> = { scope: node.scope, route: node.route, expectName: node.name };
  if (options.showChains === true) args.showChains = true;
  const reply = await bridge.request("select", args, { changes: true });
  if (!reply.ok) return reply;
  const name = reply.value.name;
  if (typeof name !== "string") return fail(1, "bad reply from the Remote Script: select without a name");
  const shown = reply.value.chains_shown;
  const chainsShown = typeof shown === "boolean" ? shown : null;
  return { ok: true, value: { name, chainsShown } };
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

/** The chains of one rack device with their real names (0001 §4). */
export interface RackChains {
  kind: "rack" | "drum";
  /** The chain names in `rack.chains` order; `names[i]` belongs to the SDK's `rack.chains[i]`. */
  names: string[];
  /** MIDI input note per chain for drum chains, when Live reports it. */
  notes: Array<number | null>;
  /** The chain's mute switch (Chain Activator off) and solo switch, in the same order. */
  mutes: boolean[];
  solos: boolean[];
}

/** At most this many racks go into one request. */
export const CHAINS_PER_REQUEST = 20;

function parseRack(entry: unknown): { chains: RackChains | null; next: number | null; total: number; offset: number } | BridgeResult<never> {
  const e = entry as Record<string, unknown> | null;
  if (typeof e !== "object" || e === null) return fail(1, "bad reply from the Remote Script: chains entry");
  // A stub: the reply budget was spent before this rack; ask again from `next`.
  if (typeof e.next === "number" && e.kind === undefined && e.chains === undefined) {
    return { chains: null, next: e.next, total: -1, offset: e.next };
  }
  const err = e.error as Record<string, unknown> | undefined;
  if (err && typeof err === "object") {
    const text = typeof err.text === "string" ? err.text : "chains failed";
    return fail(1, err.code === "stale" || err.code === "out_of_range" ? TEXT_STALE : `Remote Script: ${text}`);
  }
  const list = e.chains;
  if (
    (e.kind !== "rack" && e.kind !== "drum") ||
    typeof e.total !== "number" ||
    typeof e.offset !== "number" ||
    !Array.isArray(list) ||
    !list.every((c) => typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).name === "string")
  ) {
    return fail(1, "bad reply from the Remote Script: chains entry");
  }
  const names = list.map((c) => (c as { name: string }).name);
  const notes = list.map((c) => {
    const n = (c as { note?: unknown }).note;
    return typeof n === "number" ? n : null;
  });
  // The script sends `mute` / `solo` only when true.
  const mutes = list.map((c) => (c as { mute?: unknown }).mute === true);
  const solos = list.map((c) => (c as { solo?: unknown }).solo === true);
  const next = typeof e.next === "number" ? e.next : null;
  return { chains: { kind: e.kind, names, notes, mutes, solos }, next, total: e.total, offset: e.offset };
}

/**
 * Chain names for one or several racks, in the order given. One request in the
 * normal case; a rack whose names exceed one datagram is asked for again with
 * an offset (the 4 KB limit, 0001 §1). Each entry fails alone; the outer result
 * is the bridge/script outcome. `scope` + `route` address the rack device.
 * Never throws.
 */
export async function chains(
  bridge: Bridge,
  racks: Array<Pick<ObjectNode, "scope" | "route">>,
): Promise<BridgeResult<Array<BridgeResult<RackChains>>>> {
  const results: Array<BridgeResult<RackChains> | null> = racks.map(() => null);
  const collected: Array<RackChains | null> = racks.map(() => null);
  let pending = racks.map((_, i) => ({ index: i, offset: 0 }));
  for (let round = 0; pending.length > 0 && round < 64; round++) {
    const next: typeof pending = [];
    for (let i = 0; i < pending.length; i += CHAINS_PER_REQUEST) {
      const chunk = pending.slice(i, i + CHAINS_PER_REQUEST);
      const targets = chunk.map((p) => ({ scope: racks[p.index]!.scope, route: racks[p.index]!.route, offset: p.offset }));
      const reply = await bridge.request("chains", { targets });
      if (!reply.ok) return reply;
      const entries = reply.value.racks;
      if (!Array.isArray(entries) || entries.length !== chunk.length) {
        return fail(1, "bad reply from the Remote Script: chains without one entry per rack");
      }
      entries.forEach((entry, k) => {
        const p = chunk[k]!;
        const parsed = parseRack(entry);
        if ("ok" in parsed) {
          results[p.index] = parsed;
          return;
        }
        if (parsed.chains === null) {
          // unanswered this round: ask again (the round limit bounds a script that never makes progress)
          next.push({ index: p.index, offset: parsed.next ?? p.offset });
          return;
        }
        if (parsed.offset !== p.offset) {
          results[p.index] = fail(1, "bad reply from the Remote Script: chains offset differs from the one asked for");
          return;
        }
        const have = collected[p.index];
        if (have && have.kind !== parsed.chains.kind) {
          results[p.index] = fail(1, "bad reply from the Remote Script: chains changed between requests");
          return;
        }
        const merged: RackChains = have
          ? {
              kind: have.kind,
              names: [...have.names, ...parsed.chains.names],
              notes: [...have.notes, ...parsed.chains.notes],
              mutes: [...have.mutes, ...parsed.chains.mutes],
              solos: [...have.solos, ...parsed.chains.solos],
            }
          : parsed.chains;
        collected[p.index] = merged;
        if (parsed.next !== null && parsed.next > p.offset) next.push({ index: p.index, offset: parsed.next });
        else if (merged.names.length !== parsed.total) results[p.index] = fail(1, "bad reply from the Remote Script: chains count differs");
        else results[p.index] = { ok: true, value: merged };
      });
    }
    pending = next;
  }
  return {
    ok: true,
    value: results.map((r, i) => r ?? (collected[i] ? fail(1, "bad reply from the Remote Script: chains incomplete") : fail(1, "bad reply from the Remote Script: chains missing"))),
  };
}

/** The mute and solo switch of one chain as Live reports them right now. */
export interface ChainSwitches {
  name: string;
  mute: boolean;
  solo: boolean;
}

/**
 * Read the current switches of chain nodes (for toggling: the caller computes the
 * new value from what this returns, as `mute`/`solo` do for tracks). One `chains`
 * request per rack involved, all racks in one request. Entries in the order given.
 */
export async function chainSwitches(
  bridge: Bridge,
  nodes: Array<Pick<ObjectNode, "scope" | "route" | "name">>,
): Promise<BridgeResult<Array<BridgeResult<ChainSwitches>>>> {
  const racks = new Map<string, { scope: ObjectNode["scope"]; route: number[] }>();
  for (const n of nodes) racks.set(`${n.scope}:${n.route.slice(0, -1).join(".")}`, { scope: n.scope, route: n.route.slice(0, -1) });
  const keys = [...racks.keys()];
  const reply = await chains(bridge, [...racks.values()]);
  if (!reply.ok) return reply;
  const out: Array<BridgeResult<ChainSwitches>> = nodes.map((n) => {
    const entry = reply.value[keys.indexOf(`${n.scope}:${n.route.slice(0, -1).join(".")}`)]!;
    if (!entry.ok) return entry;
    const index = n.route[n.route.length - 1]!;
    const name = entry.value.names[index];
    if (name === undefined) return fail(1, TEXT_STALE);
    if (name !== n.name) return fail(1, TEXT_STALE);
    return { ok: true, value: { name, mute: entry.value.mutes[index] === true, solo: entry.value.solos[index] === true } };
  });
  return { ok: true, value: out };
}

/** One change of a chain's switches: set what is given, leave the rest. */
export interface ChainChange {
  mute?: boolean;
  solo?: boolean;
}

/**
 * Set mute and/or solo of chain nodes and read the result back. A writing
 * operation: it carries the access token (read from its file, re-read once on
 * `forbidden`) and needs the node's current name (`expectName`). One request
 * per `TRACK_FACTS_PER_REQUEST` chains (one normally). The outer result is the
 * bridge/script outcome; each entry answers its own chain, in order. Never throws.
 */
export async function chainSet(
  bridge: Bridge,
  changes: Array<Pick<ObjectNode, "scope" | "route" | "name"> & ChainChange>,
): Promise<BridgeResult<Array<BridgeResult<ChainSwitches>>>> {
  const out: Array<BridgeResult<ChainSwitches>> = [];
  for (const chunk of chunkTargets(changes)) {
    const targets = chunk.map((c) => ({
      scope: c.scope,
      route: c.route,
      expectName: c.name,
      ...(c.mute === undefined ? {} : { mute: c.mute }),
      ...(c.solo === undefined ? {} : { solo: c.solo }),
    }));
    const reply = await bridge.request("chain_set", { targets }, { changes: true, token: true });
    if (!reply.ok) return reply;
    const entries = reply.value.chains;
    if (!Array.isArray(entries) || entries.length !== chunk.length) {
      return fail(1, "bad reply from the Remote Script: chain_set without one entry per chain");
    }
    for (const entry of entries) out.push(parseSwitches(entry));
  }
  return { ok: true, value: out };
}

function parseSwitches(entry: unknown): BridgeResult<ChainSwitches> {
  const e = entry as Record<string, unknown> | null;
  if (typeof e !== "object" || e === null) return fail(1, "bad reply from the Remote Script: chain_set entry");
  const err = e.error as Record<string, unknown> | undefined;
  if (err && typeof err === "object") {
    const text = typeof err.text === "string" ? err.text : "chain_set failed";
    return fail(1, err.code === "stale" || err.code === "out_of_range" ? TEXT_STALE : `Remote Script: ${text}`);
  }
  if (typeof e.name !== "string" || typeof e.mute !== "boolean" || typeof e.solo !== "boolean") {
    return fail(1, "bad reply from the Remote Script: chain_set entry");
  }
  return { ok: true, value: { name: e.name, mute: e.mute, solo: e.solo } };
}
