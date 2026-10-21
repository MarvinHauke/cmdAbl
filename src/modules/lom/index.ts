import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { lomPage, lomPath, lomReferenceUrl } from "../../ableton/lomPath.js";
import { ok, type CommandResult } from "../../core/types.js";

/** The three lines `lom` answers with: cmdAbl path, LOM path, reference page. */
export function lomLines(node: ObjectNode): string[] {
  return [node.path, lomPath(node), lomReferenceUrl(lomPage(node))];
}

/**
 * `lom <target>` — where an object lives in Ableton's Live Object Model, for
 * Max for Live devices, Remote Scripts and the LOM reference. Read-only; works
 * without the Remote Script.
 */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "lom",
    topic: "Look things up",
    summary: "show the Live Object Model path of a track, device or chain",
    description:
      "Shows the object's cmdAbl path, its Live Object Model path (the address used by Max for Live's " +
      "live.path and in Remote Scripts) and the link to the LOM reference page that describes its kind. " +
      "Only reads; it does not need the cmdAbl Remote Script. When your words match several objects " +
      "you are asked to choose one.",
    examples: [
      { line: "lom /Bass", note: "the LOM path of a track" },
      { line: "lom /2-808 Core Kit/808 Core Kit/Snare Drum", note: "the LOM path of a pad inside a Drum Rack" },
      { line: "lom snare", note: "the object with \"snare\" in its name" },
    ],
    args: [
      {
        name: "target",
        kind: "path",
        kinds: ["track", "device", "chain"],
        rest: true,
        summary: "Track, device, chain or pad; spaces need no quotes",
      },
    ],
    run: (invocation): CommandResult => {
      const node = invocation.args[0]![0] as ObjectNode;
      return ok(lomLines(node).join("\n"));
    },
  });
}
