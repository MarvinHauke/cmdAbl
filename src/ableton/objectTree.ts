import type { ExtensionContext, Track } from "@ableton-extensions/sdk";
import type { PaletteItemType, TrackScope } from "../core/types.js";
import { getBridge } from "./bridge.js";
import { findRacks, getChainNameCache, type ChainNameCache } from "./chainNames.js";

// Generalizes the Phase 1 track-only snapshot into a tree of every addressable
// object with a stable place in Live's hierarchy: tracks (incl. group-track
// children, return tracks, and the main/master track), their devices and the
// chains of rack devices; other kinds slot in later
// (see docs/feature-plans/0001-path-addressed-objects-and-commands.md).
// Chain names come from the Remote Script through a cache (chainNames.ts): the
// build never waits for the script; without a cached name a rack simply has
// no chain nodes.
//
// Two things are deliberately kept distinct:
//   - `path`  is the *display/address* hierarchy ("/Vermona/Kick") — it follows
//     groupTrack relationships, because that's how a user thinks of "the Kick
//     track inside the Vermona group".
//   - `route` is the *LOM access path* ("song.tracks[2].devices[1]") — it's
//     always the flat collection index first, because that's what re-resolving
//     a track (and the host bridge's select_track) actually needs. song.tracks
//     is a flat list; group membership doesn't nest it.

// Shares its labels with PaletteItemType so a tree node converts straight into
// a PaletteItem/PaletteResult without a translation layer — "track"/"device"
// mean the same thing on both sides of that boundary.
export type NodeKind = Extract<PaletteItemType, "track" | "device" | "chain">;

/** Enough to re-resolve the live object later (handles aren't permanent — see resolve.ts). */
export interface LiveRef {
  handleId: string;
  route: number[];
  kind: NodeKind;
  scope: TrackScope;
}

export interface ObjectNode extends LiveRef {
  name: string;
  path: string;
  children: ObjectNode[];
}

export interface BuildOptions {
  /** Where chain names come from. Default: the shared cache (refreshed in the background). `null` = no chain nodes. */
  chainNames?: ChainNameCache | null;
}

/**
 * Build the tree from the SDK. Note: with the default options a build may send a
 * datagram (a background `chains` refresh through getBridge()); tests pass
 * `chainNames: null` or their own cache.
 */
export function buildObjectTree(context: ExtensionContext<"1.0.0">, options: BuildOptions = {}): ObjectNode[] {
  const song = context.application.song;
  const tracks = song.tracks;
  const cache = options.chainNames === undefined ? getChainNameCache() : options.chainNames;
  if (cache && options.chainNames === undefined) {
    // Stale-while-revalidate: the next build sees what this one asks for.
    try {
      void cache.scheduleRefresh(findRacks(song), getBridge());
    } catch {
      // never fail a tree build because of the bridge
    }
  }

  interface Entry {
    track: Track<"1.0.0">;
    node: ObjectNode;
    subTracks: ObjectNode[];
  }
  const entries = new Map<string, Entry>();

  // Pass 1: a node per regular track with its devices as children. Sub-tracks
  // are nested in pass 2 once every node exists to nest them under.
  tracks.forEach((track, index) => {
    const node = buildTrackNode(track, index, "regular", cache);
    entries.set(node.handleId, { track, subTracks: [], node });
  });

  // Pass 2: route each track to its group (or to the root) via groupTrack.
  const roots: ObjectNode[] = [];
  for (const entry of entries.values()) {
    const group = entry.track.groupTrack;
    const parent = group ? entries.get(group.handle.id.toString()) : undefined;
    if (parent) parent.subTracks.push(entry.node);
    else roots.push(entry.node);
  }

  // Sub-tracks address more naturally as direct children (/group/child),
  // so they precede the group's own devices in the child list.
  for (const entry of entries.values()) {
    entry.node.children = [...entry.subTracks, ...entry.node.children];
  }

  // Return tracks and the main ("Master") track live in their own collections
  // entirely outside song.tracks — they're always top-level and can't be
  // grouped, so they need no pass-2 nesting.
  const returnRoots = song.returnTracks.map((track, index) => buildTrackNode(track, index, "return", cache));
  const mainRoot = buildTrackNode(song.mainTrack, 0, "master", cache);

  const allRoots = [...roots, ...returnRoots, mainRoot];
  assignPaths(allRoots, "");
  return allRoots;
}

function buildTrackNode(track: Track<"1.0.0">, trackIndex: number, scope: TrackScope, cache: ChainNameCache | null): ObjectNode {
  return {
    handleId: track.handle.id.toString(),
    route: [trackIndex],
    kind: "track",
    scope,
    name: track.name,
    path: "",
    children: track.devices.map((device, deviceIndex) => {
      const route = [trackIndex, deviceIndex];
      const handleId = device.handle.id.toString();
      return {
        handleId,
        route,
        kind: "device" as const,
        scope,
        name: device.name,
        path: "",
        children: chainNodes(device, route, handleId, scope, cache),
      };
    }),
  };
}

/** The chains of a rack device, named from the cache; none when the names are unknown or out of date. */
function chainNodes(
  device: object,
  route: number[],
  handleId: string,
  scope: TrackScope,
  cache: ChainNameCache | null,
): ObjectNode[] {
  const chains = (device as { chains?: unknown }).chains;
  if (!cache || !Array.isArray(chains)) return [];
  const chainIds = chains.map((c: { handle: { id: { toString(): string } } }) => c.handle.id.toString());
  const entry = cache.get(scope, route, handleId, chainIds);
  if (!entry) return [];
  return chains.map((_chain: unknown, chainIndex: number) => ({
    handleId: chainIds[chainIndex]!,
    route: [...route, chainIndex],
    kind: "chain" as const,
    scope,
    name: entry.names[chainIndex] ?? "",
    path: "",
    children: [],
  }));
}

/**
 * Give every node its address. Siblings that share a name would otherwise get
 * the same path and all but the first would be unreachable, so the 2nd, 3rd, …
 * get an ordinal suffix: "/Drums/Kick", "/Drums/Kick#2". The suffix is a
 * disambiguator derived from the current order — not a stable identity (that
 * is the handle/route, re-checked when a command runs).
 */
export function assignPaths(siblings: ObjectNode[], parentPath: string): void {
  const seen = new Map<string, number>();
  for (const node of siblings) {
    const ordinal = (seen.get(node.name) ?? 0) + 1;
    seen.set(node.name, ordinal);
    node.path = `${parentPath}/${node.name}${ordinal > 1 ? `#${ordinal}` : ""}`;
    assignPaths(node.children, node.path);
  }
}

/** Depth-first flat view of the tree — e.g. for building searchable palette items. */
export function flattenObjectTree(roots: ObjectNode[]): ObjectNode[] {
  const result: ObjectNode[] = [];
  const visit = (node: ObjectNode): void => {
    result.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return result;
}
