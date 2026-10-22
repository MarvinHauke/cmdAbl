import type { Bridge } from "./bridgeClient.js";
import { fail, TEXT_OUTDATED, TEXT_STALE, type BridgeResult } from "./bridgeProtocol.js";
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
   * LOM: `Track.is_showing_chains` (wire `is_showing_chains`).
   */
  isShowingChains: boolean | null;
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
  // A script older than 0.1.1 answers with the old field name: say so instead of reading it as "null".
  if ("chains_shown" in reply.value && !("is_showing_chains" in reply.value)) return fail(5, TEXT_OUTDATED);
  const shown = reply.value.is_showing_chains;
  const isShowingChains = typeof shown === "boolean" ? shown : null;
  return { ok: true, value: { name, isShowingChains } };
}

/** What the SDK cannot tell about one track (0001 §4). */
export interface TrackFacts {
  /** The track's name in Live right now. */
  name: string;
  /** False for return and main tracks and for tracks Live greys out (e.g. a MIDI track without an input device). */
  canBeArmed: boolean;
  /** True for group tracks. LOM: `Track.is_foldable` (the reference: Instrument and Drum Racks report false). */
  isFoldable: boolean;
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
  return { ok: true, value: { name, canBeArmed: e.can_be_armed, isFoldable: e.is_foldable, isGrouped: e.is_grouped, arm: e.arm } };
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
  /** `DrumChain.in_note` (wire `in_note`) per chain for drum chains, when Live reports it. */
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
  // A script older than 0.1.1 sends `note` instead of `in_note`: outdated, not "no notes".
  if (list.some((c) => "note" in (c as object) && !("in_note" in (c as object)))) return fail(5, TEXT_OUTDATED);
  const notes = list.map((c) => {
    const n = (c as { in_note?: unknown }).in_note;
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

// ---- Tags on tracks (plan 0008) ---------------------------------------------------------------
// Stored by the Remote Script with Track.set_data (saved with the Set). Reads cover the whole Set in
// one go (the tree needs them for every track); a write changes one track.

/** A track that carries tags, as the script reports it. Untagged tracks are not listed. */
export interface TagEntry {
  scope: ObjectNode["scope"];
  /** Route of the track: [index in its collection]. */
  route: number[];
  /** The track's name when the tags were read: tags belong to a track only while the name still matches. */
  name: string;
  tags: string[];
}

function parseTagEntry(e: unknown): TagEntry | null {
  const o = e as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) return null;
  const route = o.route;
  if (
    (o.scope !== "regular" && o.scope !== "return" && o.scope !== "master") ||
    !Array.isArray(route) || route.length !== 1 || typeof route[0] !== "number" ||
    typeof o.name !== "string" ||
    !Array.isArray(o.tags) || !o.tags.every((t) => typeof t === "string")
  ) {
    return null;
  }
  return { scope: o.scope, route: [route[0]], name: o.name, tags: o.tags as string[] };
}

/**
 * The tags of every tagged track (regular, return, main), in the script's order. The script pages its
 * reply under the 4 KB cap; this asks again until it is complete. A script without the op answers
 * exit code 5 (outdated); a script that is not running, 5 as well. Never throws.
 */
export async function readTags(bridge: Bridge): Promise<BridgeResult<TagEntry[]>> {
  const entries: TagEntry[] = [];
  let offset = 0;
  for (let round = 0; round < 64; round++) {
    const reply = await bridge.request("tags_all", offset === 0 ? {} : { offset });
    if (!reply.ok) return reply;
    const list = reply.value.tracks;
    if (!Array.isArray(list)) return fail(1, "bad reply from the Remote Script: tags_all without tracks");
    for (const raw of list) {
      const entry = parseTagEntry(raw);
      if (!entry) return fail(1, "bad reply from the Remote Script: tags_all entry");
      entries.push(entry);
    }
    const next = reply.value.next;
    if (next === undefined) return { ok: true, value: entries };
    if (typeof next !== "number" || next <= offset) return fail(1, "bad reply from the Remote Script: tags_all paging");
    offset = next;
  }
  return fail(1, "bad reply from the Remote Script: tags_all did not finish");
}

/** What a tag write reports back. */
export interface TagsWritten {
  /** The track's name in Live right now. */
  name: string;
  /** The tags as Live stored them (read back). */
  tags: string[];
  /** False when the colour toggle that makes Live ask to save did not work: the tags are stored regardless. */
  marked: boolean;
}

/**
 * Replace the tags of one track (an empty list removes them). A writing operation: it carries the
 * access token and the track's current name; a track whose name changed answers exit code 1
 * ("the Live Set changed; run the command again"). Tags are stored as given: normalising them is the
 * caller's job. Never throws; a script that is not running answers exit code 5.
 */
export async function writeTags(
  bridge: Bridge,
  track: Pick<ObjectNode, "scope" | "route" | "name">,
  tags: string[],
): Promise<BridgeResult<TagsWritten>> {
  const reply = await bridge.request("tags_set", { scope: track.scope, route: track.route, expectName: track.name, tags }, { changes: true, token: true });
  if (!reply.ok) return reply;
  const v = reply.value;
  if (typeof v.name !== "string" || !Array.isArray(v.tags) || !v.tags.every((t) => typeof t === "string") || typeof v.marked !== "boolean") {
    return fail(1, "bad reply from the Remote Script: tags_set");
  }
  return { ok: true, value: { name: v.name, tags: v.tags as string[], marked: v.marked } };
}

/** The mixer parameters `paramDisplay` knows (the script's table; "pan" and the sends can join later). */
export type DisplayParam = "volume";
/** The most values the script takes per request; `paramDisplay` sends longer lists in chunks. */
export const PARAM_DISPLAY_MAX_VALUES = 64;

/**
 * Live's own display text for values of a track's mixer parameter ("-6.0 dB", "-inf dB"), as
 * `DeviceParameter.str_for_value` reports it, without moving the fader. `values` are in the
 * parameter's own units (volume: 0..1, as the SDK's `mixer.volume`). The answer has one string per
 * value, in order; a longer list goes out in chunks of PARAM_DISPLAY_MAX_VALUES. A read: no token.
 * Never throws; a script that is not running answers exit code 5, an older one (no such op) 5 too.
 */
export async function paramDisplay(
  bridge: Bridge,
  track: Pick<ObjectNode, "scope" | "route" | "name">,
  param: DisplayParam,
  values: number[],
): Promise<BridgeResult<string[]>> {
  const strings: string[] = [];
  for (let i = 0; i < values.length || i === 0; i += PARAM_DISPLAY_MAX_VALUES) {
    const chunk = values.slice(i, i + PARAM_DISPLAY_MAX_VALUES);
    if (chunk.length === 0) return { ok: true, value: [] };
    const reply = await bridge.request("param_display", { scope: track.scope, route: track.route, expectName: track.name, param, values: chunk });
    if (!reply.ok) return reply;
    const got = reply.value.strings;
    if (!Array.isArray(got) || got.length !== chunk.length || !got.every((s) => typeof s === "string")) {
      return fail(1, "bad reply from the Remote Script: param_display strings");
    }
    strings.push(...(got as string[]));
  }
  return { ok: true, value: strings };
}

/**
 * The Live Set's own id (plan 0013), kept in the Set by the Remote Script. `create` false only reads;
 * true stores a new random id when the Set has none (and marks the Set as modified). Resolves to the
 * id, or null when the Set has none, the script is not running, too old, or anything went wrong:
 * never throws. The op is a writing op (the token is sent also for a read).
 */
export async function setId(bridge: Bridge, create = false): Promise<string | null> {
  try {
    const reply = await bridge.request("set_id", create ? { create: true } : {}, { changes: create, token: true });
    if (!reply.ok) return null;
    const id = reply.value.id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}
