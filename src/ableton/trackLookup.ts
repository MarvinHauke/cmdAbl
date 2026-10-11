import type { ExtensionContext, Track } from "@ableton-extensions/sdk";
import { buildObjectTree, flattenObjectTree, type ObjectNode } from "./objectTree.js";
import { resolvePath } from "./resolvePath.js";

// Used by commands that take a path argument (mute/solo) rather than picking
// from a palette snapshot — they walk the *live* tree fresh on every run, so
// (unlike resolve.ts's snapshot-then-reresolve dance) there's nothing that
// can go stale between typing the command and it executing.

/** Every track the address names — the caller decides what zero or several matches mean. */
export function findTracksByPath(context: ExtensionContext<"1.0.0">, query: string): ObjectNode[] {
  return resolvePath(flattenObjectTree(buildObjectTree(context)), query, ["track"]);
}

/** The live SDK track behind a resolved node. */
export function trackFor(context: ExtensionContext<"1.0.0">, node: ObjectNode): Track<"1.0.0"> | null {
  const song = context.application.song;
  const collection =
    node.scope === "return" ? song.returnTracks : node.scope === "master" ? [song.mainTrack] : song.tracks;
  return collection[node.route[0]!] ?? null;
}
