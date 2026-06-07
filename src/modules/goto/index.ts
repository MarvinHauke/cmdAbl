import type { ModuleApi } from "../types.js";
import type { PaletteResult } from "../../types.js";
import { snapshotObjectTree } from "./snapshot.js";
import { resolveRef } from "./resolve.js";
import { selectTrack, selectDevice } from "../../ableton/bridge.js";

/**
 * Surfaces the Set's addressable objects (tracks, group tracks, devices) in
 * the palette and routes their selection through the companion Remote Script
 * — the cmdAbl functionality that resolves "go to this object" requests.
 */
export function activate(api: ModuleApi): void {
  api.registerProvider({ getItems: () => snapshotObjectTree(api.context) });

  api.registerResultHandler("select", (result: PaletteResult): void => {
    // Selection lives in the LOM, not the Extensions SDK, so we hand the
    // object's current route to the companion Remote Script over UDP.
    const resolved = resolveRef(api.context, result);
    if (!resolved) {
      api.showFeedback(`cmdAbl: that ${result.type} is no longer available.`);
      return;
    }
    if (resolved.kind === "track") selectTrack(resolved.scope, resolved.route[0]);
    else selectDevice(resolved.scope, resolved.route[0], resolved.route[1]);
  });
}
