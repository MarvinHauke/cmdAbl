import type { ModuleApi } from "./types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { trackFor } from "../ableton/trackLookup.js";
import { armDecision, nextTrackValue, notChanged, type TrackSetValue } from "./trackSetValue.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../types.js";

// Shared by mute/unmute, solo/unsolo and arm/unarm. Two modes:
//  - a boolean sets that value on every named track (`unmute`, `unsolo`,
//    `unarm` always switch off, so re-running them is harmless);
//  - "toggle" flips the property on each track individually (`mute`, `solo`,
//    `arm`), so one command switches a track on and off. Re-running a toggle
//    from history therefore toggles back — that is intended.
//
// `arm` is special: a return or main track cannot be armed, and Live (via the
// SDK) neither throws nor changes anything when asked. Those are refused up
// front; for anything else Live may refuse (a group track), the value is read
// back after the transaction and a write that did not take is reported.
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
      const nodes = (invocation.args[0] ?? []) as ObjectNode[];
      const outcomes: TargetOutcome[] = [];
      const written: WrittenArm[] = [];

      // One transaction = one undo step for the whole command.
      api.context.withinTransaction(() => {
        for (const node of nodes) {
          const track = trackFor(api.context, node);
          if (!track) {
            outcomes.push({ path: node.path, ok: false, code: ExitCode.NOT_FOUND, message: "track is gone" });
            continue;
          }
          try {
            const wanted = nextTrackValue(track[prop], value);
            if (prop === "arm") {
              const decision = armDecision(node.scope, wanted);
              if (decision === "refuse") {
                outcomes.push({ path: node.path, ok: false, message: "cannot be armed" });
                continue;
              }
              if (decision === "skip") {
                outcomes.push({ path: node.path, ok: true });
                continue;
              }
              written.push({ node, wanted, outcome: outcomes.length });
            }
            track[prop] = wanted;
            outcomes.push({ path: node.path, ok: true });
          } catch (e: unknown) {
            outcomes.push({ path: node.path, ok: false, message: e instanceof Error ? e.message : String(e) });
          }
        }
      });

      if (prop === "arm") verifyArm(api, written, outcomes);

      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length === 0) return ok();
      return fail(ExitCode.FAILURE, `${name}: ${outcomes.length - failed.length}/${outcomes.length} done`, outcomes);
    },
  });
}

interface WrittenArm {
  node: ObjectNode;
  wanted: boolean;
  /** Index of this track's entry in the outcomes list. */
  outcome: number;
}

/**
 * Read `arm` back for the tracks that were written (after the transaction) and
 * turn a value that did not take into a failed target. Kept separate so it can
 * go if read-back turns out to report false failures on ordinary tracks.
 */
function verifyArm(api: ModuleApi, written: WrittenArm[], outcomes: TargetOutcome[]): void {
  for (const w of written) {
    const outcome = outcomes[w.outcome];
    if (!outcome || !outcome.ok) continue; // a write that threw is already a failure
    try {
      const track = trackFor(api.context, w.node);
      if (track && notChanged(w.wanted, track.arm)) {
        outcomes[w.outcome] = {
          path: w.node.path,
          ok: false,
          message: "did not change",
        };
      }
    } catch (e: unknown) {
      outcomes[w.outcome] = { path: w.node.path, ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
