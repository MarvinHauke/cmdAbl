import type { ModuleApi } from "./types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { trackFor } from "../ableton/trackLookup.js";
import { getBridge } from "../ableton/bridge.js";
import { armFactsLines, armReadBackLine, loadArmFacts } from "./armFacts.js";
import { armDecision, armRefusal, factsRefusal, isGroupNode, nextTrackValue, notChanged, type TrackSetValue } from "./trackSetValue.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../types.js";

// Shared by mute/unmute, solo/unsolo and arm/unarm. Two modes:
//  - a boolean sets that value on every named track (`unmute`, `unsolo`,
//    `unarm` always switch off, so re-running them is harmless);
//  - "toggle" flips the property on each track individually (`mute`, `solo`,
//    `arm`), so one command switches a track on and off. Re-running a toggle
//    from history therefore toggles back — that is intended.
//
// `arm` is special: a return, main or group track cannot be armed, and asking
// Live (via the SDK) is not a harmless no-op — it neither throws nor takes
// effect, and a write to a group track left the extension's dialogs hanging.
// Those are refused up front, without a write. For anything else Live may
// refuse, the value is read back after the transaction and a write that did
// not take is reported. `mute` and `solo` stay legitimate on group tracks.
// When the Remote Script is reachable, `arm` also asks Live (`track_facts`) up
// front and refuses tracks Live greys out (a MIDI track without an input
// device); without the script it behaves as above. The command does not
// require the script.
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
    run: async (invocation): Promise<CommandResult> => {
      const nodes = (invocation.args[0] ?? []) as ObjectNode[];
      const outcomes: TargetOutcome[] = [];
      const written: WrittenArm[] = [];

      // Arming asks Live what it knows about the tracks first (one request,
      // before any write) — only when the Remote Script is there; otherwise
      // the SDK-only path below. Disarming needs no facts.
      const loaded = prop === "arm" && value !== false ? await loadArmFacts(getBridge(), nodes) : undefined;
      const facts = loaded?.facts;
      // Evidence for what Live reports (names and booleans only).
      if (loaded) for (const line of armFactsLines(nodes, loaded)) console.log(line);

      // One transaction = one undo step for the whole command.
      api.context.withinTransaction(() => {
        nodes.forEach((node, index) => {
          const track = trackFor(api.context, node);
          if (!track) {
            outcomes.push({ path: node.path, ok: false, code: ExitCode.NOT_FOUND, message: "track is gone" });
            return;
          }
          try {
            if (prop === "arm") {
              // A track that cannot be armed is decided without touching it:
              // not even a read — it is off, so toggling or arming means "on".
              const isGroup = isGroupNode(node);
              const wantedOnUnarmable = value === "toggle" ? true : value;
              const decision = armDecision(node.scope, wantedOnUnarmable, isGroup);
              if (decision === "refuse") {
                outcomes.push({ path: node.path, ok: false, message: armRefusal(isGroup) });
                return;
              }
              if (decision === "skip") {
                outcomes.push({ path: node.path, ok: true });
                return;
              }
              // Live's own answer; the stricter of it and the local check wins.
              const objection = factsRefusal(facts?.[index]);
              if (objection) {
                outcomes.push({ path: node.path, ok: false, message: objection });
                return;
              }
              const wanted = nextTrackValue(track.arm, value);
              written.push({ node, wanted, outcome: outcomes.length });
              track.arm = wanted;
            } else {
              track[prop] = nextTrackValue(track[prop], value);
            }
            outcomes.push({ path: node.path, ok: true });
          } catch (e: unknown) {
            outcomes.push({ path: node.path, ok: false, message: e instanceof Error ? e.message : String(e) });
          }
        });
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
      if (track) console.log(armReadBackLine(w.node.path, w.wanted, track.arm));
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
