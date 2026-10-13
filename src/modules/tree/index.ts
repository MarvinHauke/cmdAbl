import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ok, type CommandResult } from "../../core/types.js";
import { renderTree } from "./render.js";

const DEFAULT_DEPTH = 2;

/**
 * `tree [path] [-L <n>]` — the Live Set as an indented list, modelled on the
 * Unix `tree`. Read-only; works without the Remote Script (rack chains and
 * pads appear only when their names are known).
 */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "tree",
    summary: "list the tracks, devices and chains of the Live Set as a tree",
    description:
      "Lists the Live Set as an indented tree: tracks (regular, return, main), their devices, and the chains " +
      "and drum pads of racks, each with its kind, and a last line counting what is listed. Without a path it " +
      "starts at the whole Set; with a path it starts at that track, device or chain. -L sets how many levels " +
      "below the start are shown (default 2). Only reads; chains and pads appear when the cmdAbl Remote Script is " +
      "running. A listing of more than 200 lines is cut: pass a path or a smaller -L.",
    examples: [
      { line: "tree", note: "the whole Set, two levels: tracks and their devices" },
      { line: "tree /Vermona MIDI", note: "one track with its devices and chains" },
      { line: "tree -L 3 vermona", note: "three levels below the object matching \"vermona\"" },
      { line: "tree --level 1", note: "only the tracks" },
    ],
    options: [
      {
        name: "level",
        short: "L",
        takesValue: true,
        number: { min: 1, max: 12, integer: true },
        summary: `how many levels below the start are shown (default ${DEFAULT_DEPTH})`,
      },
    ],
    args: [
      {
        name: "path",
        kind: "path",
        kinds: ["track", "device", "chain"],
        required: false,
        rest: true,
        summary: "Where the listing starts: a track, device or chain; without it, the whole Set",
      },
    ],
    run: (invocation): CommandResult => {
      const level = invocation.options.level;
      const depth = typeof level === "string" ? Number(level) : DEFAULT_DEPTH;
      const start = invocation.args[0]?.[0] as ObjectNode | undefined;
      return ok(renderTree(api.liveSet.nodes(), { start, depth }));
    },
  });
}
