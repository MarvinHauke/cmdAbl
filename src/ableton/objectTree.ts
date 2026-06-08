import type { ExtensionContext, Track } from "@ableton-extensions/sdk";
import type { PaletteItemType, TrackScope } from "../types.js";

// Generalizes the Phase 1 track-only snapshot into a tree of every addressable
// object with a stable place in Live's hierarchy: tracks (incl. group-track
// children, return tracks, and the main/master track) and their devices today;
// chains and other kinds slot in later
// (see docs/feature-plans/0001-path-addressed-objects-and-commands.md).
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
export type NodeKind = Extract<PaletteItemType, "track" | "device">;

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

export function buildObjectTree(context: ExtensionContext<"1.0.0">): ObjectNode[] {
  const song = context.application.song;
  const tracks = song.tracks;

  interface Entry {
    track: Track<"1.0.0">;
    node: ObjectNode;
    subTracks: ObjectNode[];
  }
  const entries = new Map<string, Entry>();

  // Pass 1: a node per regular track with its devices as children. Sub-tracks
  // are nested in pass 2 once every node exists to nest them under.
  tracks.forEach((track, index) => {
    const node = buildTrackNode(track, index, "regular");
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
  const returnRoots = song.returnTracks.map((track, index) => buildTrackNode(track, index, "return"));
  const mainRoot = buildTrackNode(song.mainTrack, 0, "master");

  const allRoots = [...roots, ...returnRoots, mainRoot];
  for (const root of allRoots) assignPaths(root, "");
  return allRoots;
}

function buildTrackNode(track: Track<"1.0.0">, trackIndex: number, scope: TrackScope): ObjectNode {
  return {
    handleId: track.handle.id.toString(),
    route: [trackIndex],
    kind: "track",
    scope,
    name: track.name,
    path: "",
    children: track.devices.map((device, deviceIndex) => ({
      handleId: device.handle.id.toString(),
      route: [trackIndex, deviceIndex],
      kind: "device" as const,
      scope,
      name: device.name,
      path: "",
      children: [],
    })),
  };
}

function assignPaths(node: ObjectNode, parentPath: string): void {
  node.path = `${parentPath}/${node.name}`;
  for (const child of node.children) assignPaths(child, node.path);
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
