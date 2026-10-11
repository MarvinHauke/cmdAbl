import type { ExtensionContext, Track } from "@ableton-extensions/sdk";
import type { ObjectNode } from "./objectTree.js";

/** The live SDK track behind a resolved node. */
export function trackFor(context: ExtensionContext<"1.0.0">, node: ObjectNode): Track<"1.0.0"> | null {
  const song = context.application.song;
  const collection =
    node.scope === "return" ? song.returnTracks : node.scope === "master" ? [song.mainTrack] : song.tracks;
  return collection[node.route[0]!] ?? null;
}
