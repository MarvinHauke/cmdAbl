import type { ModuleApi } from "../types.js";
import { snapshotObjectTree } from "./snapshot.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { selectNodeResult } from "../selectNode.js";

/**
 * Surfaces the Set's addressable objects (tracks, group tracks, devices, chains) in
 * the palette and selects them (tracks, devices, rack chains and drum pads) through the companion Remote Script's
 * request/reply bridge (`select`, with a name check and read-back).
 */
export function activate(api: ModuleApi): void {
  api.registerProvider({ getItems: () => snapshotObjectTree(api.liveSet.nodes()) });

  // `goto <path>` — also what a picked palette row runs (the platform turns
  // the row into `goto <unique path>`). The path arrives resolved to exactly
  // one object; if it was ambiguous the platform already asked the user to pick. A missing/outdated script is
  // answered by the platform (exit 5) before the path is resolved.
  api.commands.add({
    name: "goto",
    summary: "select a track, device, chain or drum pad by path",
    description:
      "Selects the object in Live: a track becomes the selected track; a device, chain or pad is selected in its track's device chain. Needs the cmdAbl Remote Script. " +
      "Picking an object in the palette runs this command for you. When your words match several objects " +
      "you are asked to choose one.",
    examples: [
      { line: "goto /Lead", note: "select a track" },
      { line: "goto /2-808 Core Kit/808 Core Kit/Snare Drum", note: "select a pad inside a Drum Rack" },
      { line: "goto snare", note: "select the object with \"snare\" in its name (you choose when there are several)" },
      { line: "goto --unfold /2-808 Core Kit", note: "select a track and show its chains in the Session mixer" },
    ],
    requires: ["bridge"],
    options: [{ name: "unfold", summary: "also show the track's chains in the Session mixer (never folds anything)" }],
    args: [
      {
        name: "path",
        kind: "path",
        rest: true,
        summary: "Path of the track, device, chain or pad; spaces need no quotes",
      },
    ],
    run: (invocation) =>
      selectNodeResult(api.bridge, invocation.args[0]![0] as ObjectNode, { unfold: invocation.options.unfold === true }),
  });
}
