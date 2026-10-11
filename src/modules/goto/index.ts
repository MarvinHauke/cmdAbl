import type { ModuleApi } from "../types.js";
import type { PaletteResult } from "../../types.js";
import { snapshotObjectTree } from "./snapshot.js";
import { resolveRef } from "./resolve.js";
import { selectTrack, selectDevice } from "../../ableton/bridge.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { selectNode } from "../../ableton/select.js";

/**
 * Surfaces the Set's addressable objects (tracks, group tracks, devices) in
 * the palette and routes their selection through the companion Remote Script
 * — the cmdAbl functionality that resolves "go to this object" requests.
 */
export function activate(api: ModuleApi): void {
  api.registerProvider({ getItems: () => snapshotObjectTree(api.context) });

  // `goto <path>` — the typed counterpart of picking an object in the palette.
  // The path arrives resolved to exactly one object; if it was ambiguous the
  // platform already asked the user to pick.
  api.commands.add({
    name: "goto",
    summary: "select a track or device by path",
    args: [{ name: "path", kind: "path", rest: true }],
    run: (invocation) => {
      selectNode(invocation.args[0]![0] as ObjectNode);
    },
  });

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
