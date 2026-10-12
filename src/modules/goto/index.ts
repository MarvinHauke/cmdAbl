import type { ModuleApi } from "../types.js";
import { snapshotObjectTree } from "./snapshot.js";
import { getBridge } from "../../ableton/bridge.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { selectNodeResult } from "../selectNode.js";

/**
 * Surfaces the Set's addressable objects (tracks, group tracks, devices, chains) in
 * the palette and selects them (tracks, devices, rack chains and drum pads) through the companion Remote Script's
 * request/reply bridge (`select`, with a name check and read-back).
 */
export function activate(api: ModuleApi): void {
  api.registerProvider({ getItems: () => snapshotObjectTree(api.context) });

  // `goto <path>` — also what a picked palette row runs (the platform turns
  // the row into `goto <unique path>`). The path arrives resolved to exactly
  // one object; if it was ambiguous the platform already asked the user to pick. A missing/outdated script is
  // answered by the platform (exit 5) before the path is resolved.
  api.commands.add({
    name: "goto",
    summary: "select a track or device by path",
    requires: ["bridge"],
    options: [{ name: "unfold", summary: "also show the track's chains in the mixer" }],
    args: [{ name: "path", kind: "path", rest: true }],
    run: (invocation) =>
      selectNodeResult(getBridge(), invocation.args[0]![0] as ObjectNode, { unfold: invocation.options.unfold === true }),
  });
}
