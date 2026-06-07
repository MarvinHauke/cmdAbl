import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { Provider, PaletteItem } from "../types.js";
import { snapshotObjectTree } from "../ableton/snapshot.js";

/** Surfaces the Set's addressable objects (tracks, group tracks, devices) as palette items. */
export function createObjectProvider(context: ExtensionContext<"1.0.0">): Provider {
  return {
    getItems: (): PaletteItem[] => snapshotObjectTree(context),
  };
}
