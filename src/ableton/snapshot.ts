import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem } from "../types.js";

// Reading a track's name is a synchronous getter, so snapshotting the current
// Set is cheap. We do it once each time the palette opens — the modal is
// short-lived, so the data can't go stale underneath it.
//
// The handle id is stored so the track can be re-resolved at execute time (to
// recover its current index after a reorder); the index is kept as a fallback.

export function snapshotTracks(context: ExtensionContext<"1.0.0">): PaletteItem[] {
  return context.application.song.tracks.map((track, index) => {
    const name = track.name;
    return {
      id: track.handle.id.toString(),
      index,
      type: "track",
      action: "select",
      title: name,
      subtitle: "track",
      keywords: [name],
    };
  });
}
