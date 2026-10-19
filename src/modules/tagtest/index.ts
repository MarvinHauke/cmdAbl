import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { trackTags, trackTagsSet, type TrackTagsWrite } from "../../ableton/bridgeOps.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";

const SPIKE = "Temporary spike for tags (plan 0008), removed before 0.2.0. ";

/** `tagtest get` as plain lines: what Live reports for the tag key. */
export function tagsLines(s: { name: string; present: boolean; type?: string; length?: number; value?: unknown }): string[] {
  const lines = [`track: ${s.name}`, `present: ${s.present}`];
  if (s.type !== undefined) lines.push(`type: ${s.type}`);
  if (s.length !== undefined) lines.push(`length: ${s.length}`);
  if ("value" in s) lines.push(`value: ${JSON.stringify(s.value)}`);
  return lines;
}

/**
 * `tagtest get <track>` / `tagtest set <track> …` — a spike (plan 0008) that
 * shows what Live does with data stored on a track. A group, because a path
 * argument cannot be followed by a subcommand word.
 */
export function activate(api: ModuleApi): void {
  const track = {
    name: "track",
    kind: "path" as const,
    kinds: ["track" as const],
    rest: true,
    summary: "The track; spaces need no quotes",
  };

  api.commands.add({
    name: "tagtest",
    summary: "spike for tags: read and write data stored on a track",
    description:
      SPIKE + "Reads or writes the data Live keeps on a track through the Remote Script, to find out what " +
      "Live saves, copies and undoes.",
    children: [
      {
        name: "get",
        summary: "show what is stored on a track (spike for tags, removed before 0.2.0)",
        description: SPIKE + "Shows the type, length and value of the data stored on the track, if any.",
        examples: [{ line: "tagtest get /Bass", note: "what is stored on the track Bass" }],
        requires: ["bridge"],
        args: [track],
        run: async (invocation): Promise<CommandResult> => {
          const node = invocation.args[0]![0] as ObjectNode;
          const r = await trackTags(api.bridge, node);
          return r.ok ? ok(tagsLines(r.value).join("\n")) : fail(r.code, r.text);
        },
      },
      {
        name: "set",
        summary: "store data on a track (spike for tags, removed before 0.2.0)",
        description:
          SPIKE + "Stores the given text on the track, wrapped as a list or a dictionary with --as, or a long " +
          "string with --fill, or clears it. The reply says what Live kept and whether it reads back the same.",
        examples: [
          { line: "tagtest set /Bass --value kick,low", note: "store the text on the track Bass" },
          { line: "tagtest set /Bass --value kick --as list --undo", note: "store it as a list, as one undo step" },
          { line: "tagtest set /Bass --fill 10000", note: "store a string of 10000 characters" },
          { line: "tagtest set /Bass --clear", note: "store nothing" },
        ],
        requires: ["bridge"],
        options: [
          { name: "value", takesValue: true, summary: "the text to store" },
          { name: "as", takesValue: true, choices: ["string", "list", "dict"], summary: "store the text as it is, in a list or in a dictionary" },
          { name: "fill", takesValue: true, number: { min: 0, max: 1000000, integer: true }, summary: "store a string of this many characters instead" },
          { name: "clear", summary: "store nothing (there is no delete)" },
          { name: "undo", summary: "make the write one undo step" },
        ],
        args: [track],
        run: async (invocation): Promise<CommandResult> => {
          const node = invocation.args[0]![0] as ObjectNode;
          const o = invocation.options;
          const write: TrackTagsWrite = {};
          if (typeof o.value === "string") write.value = o.value;
          if (typeof o.fill === "string") write.fill = Number(o.fill);
          if (typeof o.as === "string") write.as = o.as as TrackTagsWrite["as"];
          if (o.clear === true) write.clear = true;
          if (o.undo === true) write.undo = true;
          if (write.value === undefined && write.fill === undefined && !write.clear) {
            return fail(ExitCode.USAGE, "tagtest set: give --value, --fill or --clear");
          }
          const r = await trackTagsSet(api.bridge, node, write);
          if (!r.ok) return fail(r.code, r.text);
          const w = r.value;
          return ok([`track: ${w.name}`, `stored: ${w.stored}`, `type: ${w.type}`, `length: ${w.length}`, `same: ${w.same}`].join("\n"));
        },
      },
    ],
  });
}
