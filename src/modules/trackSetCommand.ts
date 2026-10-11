import type { ModuleApi } from "./types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { trackFor } from "../ableton/trackLookup.js";
import { nextTrackValue, uniqueTracks, type TrackSetValue } from "./trackSetValue.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../types.js";

// Shared by mute/unmute, solo/unsolo and arm/unarm. Two modes:
//  - a boolean sets that value on every named track (`unmute`, `unsolo`,
//    `unarm` always switch off, so re-running them is harmless);
//  - "toggle" flips the property on each track individually (`mute`, `solo`,
//    `arm`), so one command switches a track on and off. Re-running a toggle
//    from history therefore toggles back — that is intended.
//
// The tracks arrive already resolved (the platform turns paths into objects
// and asks the user when an address is ambiguous), so this only writes.

export function registerTrackSetCommand(
  api: ModuleApi,
  name: string,
  prop: "mute" | "solo" | "arm",
  value: TrackSetValue,
  summary: string,
): void {
  api.commands.add({
    name,
    summary,
    args: [{ name: "track", kind: "path", kinds: ["track"], variadic: true }],
    run: (invocation): CommandResult => {
      const nodes = uniqueTracks((invocation.args[0] ?? []) as ObjectNode[]);
      const outcomes: TargetOutcome[] = [];

      // One transaction = one undo step for the whole command.
      api.context.withinTransaction(() => {
        for (const node of nodes) {
          const track = trackFor(api.context, node);
          if (!track) {
            outcomes.push({ path: node.path, ok: false, code: ExitCode.NOT_FOUND, message: "track is gone" });
            continue;
          }
          try {
            track[prop] = nextTrackValue(track[prop], value);
            outcomes.push({ path: node.path, ok: true });
          } catch (e: unknown) {
            outcomes.push({ path: node.path, ok: false, message: e instanceof Error ? e.message : String(e) });
          }
        }
      });

      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length === 0) return ok();
      return fail(ExitCode.FAILURE, `${name}: ${outcomes.length - failed.length}/${outcomes.length} done`, outcomes);
    },
  });
}
