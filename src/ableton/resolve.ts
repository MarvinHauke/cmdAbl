import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteResult } from "../types.js";

// Snapshot handles are not permanent (moving/deleting an object invalidates
// them) and the SDK forbids reconstructing one from a stored id. So we re-walk
// the live model and match the host-provided handle id to find the track's
// *current* index — that index is the cross-runtime key the Remote Script uses
// (the SDK handle id and the LOM object id are different id spaces). Falls back
// to the recorded index if the id is gone.

export function resolveTrackIndex(
  context: ExtensionContext<"1.0.0">,
  result: PaletteResult,
): number {
  const tracks = context.application.song.tracks;
  const byId = tracks.findIndex((t) => t.handle.id.toString() === result.id);
  if (byId !== -1) return byId;
  if (result.index !== undefined && result.index < tracks.length) {
    return result.index;
  }
  return -1;
}
