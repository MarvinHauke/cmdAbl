import type { ExtensionContext, Track } from "@ableton-extensions/sdk";
import { buildObjectTree, flattenObjectTree } from "./objectTree.js";

// Used by commands that take a path argument (mute/solo) rather than picking
// from a palette snapshot — they walk the *live* tree fresh on every run, so
// (unlike resolve.ts's snapshot-then-reresolve dance) there's nothing that
// can go stale between typing the command and it executing.

/** Finds a track by its display path ("/Vermona/Kick"), tolerating a missing leading slash and partial matches. */
export function findTrackByPath(context: ExtensionContext<"1.0.0">, query: string): Track<"1.0.0"> | null {
  const tracks = flattenObjectTree(buildObjectTree(context)).filter((node) => node.kind === "track");
  const exact = tracks.find((node) => node.path === query || node.path === `/${query}`);
  const node = exact ?? tracks.find((node) => node.path.toLowerCase().includes(query.toLowerCase()));
  if (!node) return null;

  const song = context.application.song;
  const collection =
    node.scope === "return" ? song.returnTracks : node.scope === "master" ? [song.mainTrack] : song.tracks;
  return collection[node.route[0]] ?? null;
}
