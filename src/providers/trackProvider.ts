import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { Provider, PaletteItem } from "../types.js";
import { snapshotTracks } from "../ableton/snapshot.js";

/** Surfaces the Set's tracks (mute/solo toggles) as palette items. */
export function createTrackProvider(context: ExtensionContext<"1.0.0">): Provider {
  return {
    getItems: (): PaletteItem[] => snapshotTracks(context),
  };
}
