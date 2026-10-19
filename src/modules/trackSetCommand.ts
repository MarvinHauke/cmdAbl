import type { ModuleApi } from "./types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import type { Bridge } from "../ableton/bridgeClient.js";
import { setChainSwitch } from "./chainSwitch.js";
import { readSwitchStates } from "./trackSetState.js";
import {
  armBase,
  armFactsLines,
  armNotChangedText,
  armReadBackLine,
  armVerifyLine,
  loadArmFacts,
  verifyArmWrites,
} from "./armFacts.js";
import { armDecision, armRefusal, factsRefusal, isGroupNode, nextTrackValue, notChanged, type TrackSetValue } from "./trackSetValue.js";
import type { CommandExample } from "../core/commandTree.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../core/types.js";

// Shared by mute, solo and arm. Two modes, chosen by the `--set` option:
//  - without it, "toggle" flips the property on each track individually, so
//    one command switches a track on and off. Re-running a toggle from
//    history therefore toggles back — that is intended;
//  - `--set 1` / `--set 0` makes every target muted / soloed / armed (or not),
//    whatever it was, so re-running it is harmless and a target already in the
//    wanted state is a success.
//
// `arm` is special: a return, main or group track cannot be armed, and asking
// Live (via the SDK) is not a harmless no-op — it neither throws nor takes
// effect, and a write to a group track left the extension's dialogs hanging.
// Those are refused up front, without a write; so, with the Remote Script, is
// a track whose facts say `canBeArmed` is false. A MIDI track whose input
// device is missing is greyed out in Live but still reports itself as armable
// and the SDK keeps the written value, so that case is caught after the write:
// with the script, its `arm` is the base of a toggle and is read again after
// the write; a track that did not take the value is a failure and the SDK is
// set back to what Live reads (a second undo step may remain). Without the
// script only the SDK read-back is left. `mute` and `solo` stay legitimate on
// group tracks. The command does not require the script.
//
// The tracks arrive already resolved (the platform turns paths into objects
// and asks the user when an address is ambiguous), so this only writes.

/** The texts of `--help` and the generated command reference. */
export interface TrackSetDocs {
  description: string;
  examples: CommandExample[];
  /** What the target argument is, e.g. "Tracks, rack chains or Drum Rack pads to mute". */
  targetSummary: string;
}

const STATE = { mute: "muted", solo: "soloed", arm: "armed" } as const;

export function registerTrackSetCommand(
  api: ModuleApi,
  name: string,
  prop: "mute" | "solo" | "arm",
  summary: string,
  docs: TrackSetDocs,
): void {
  api.commands.add({
    name,
    summary,
    description: docs.description,
    examples: docs.examples,
    // The pick list shows which rows already are muted / soloed / armed.
    pickState: {
      label: STATE[prop],
      read: (nodes) => readSwitchStates(api, prop, nodes),
      // What the command would do to each row: set it, or toggle it.
      change: (invocation) => {
        const set = invocation.options.set;
        return set === "1" ? "on" : set === "0" ? "off" : "toggle";
      },
    },
    // `--set 1` / `--set 0` name the state the command is called after
    // (muted, soloed, armed — like the LOM's `mute = 1`); without it every
    // target is toggled.
    options: [
      {
        name: "set",
        short: "s",
        takesValue: true,
        choices: ["0", "1"],
        summary: `make sure every target is ${STATE[prop]} (1) or not (0) instead of toggling`,
      },
    ],
    // mute/solo also work on rack chains and Drum Rack pads (through the
    // Remote Script); arm is for tracks only.
    args: [
      {
        name: "track",
        kind: "path",
        kinds: prop === "arm" ? ["track"] : ["track", "chain"],
        variadic: true,
        summary: docs.targetSummary,
      },
    ],
    run: async (invocation): Promise<CommandResult> => {
      const set = invocation.options.set;
      const value: TrackSetValue = set === "1" ? true : set === "0" ? false : "toggle";
      const targets = (invocation.args[0] ?? []) as ObjectNode[];
      // Tracks go through the SDK (no Remote Script needed); chains through the bridge.
      const chainSlots = targets.map((n, i) => (n.kind === "chain" ? i : -1)).filter((i) => i >= 0);
      const trackSlots = targets.map((n, i) => (n.kind === "chain" ? -1 : i)).filter((i) => i >= 0);
      const nodes = trackSlots.map((i) => targets[i]!);
      const outcomes: TargetOutcome[] = [];
      const written: WrittenArm[] = [];

      // `arm` (with or without `--set`) asks Live what it knows about the tracks first (one
      // request, before any write) — only when the Remote Script is there;
      // otherwise the SDK-only path below. The script's `arm` is the truth a
      // toggle starts from: the SDK's value can be wrong for a track Live
      // refused to arm.
      const loaded = prop === "arm" ? await loadArmFacts(api.bridge, nodes) : undefined;
      const facts = loaded?.facts;
      // Evidence for what Live reports (names and booleans only).
      if (loaded) for (const line of armFactsLines(nodes, loaded)) api.log(line);

      // One transaction = one undo step for the whole command.
      api.tracks.transaction(() => {
        nodes.forEach((node, index) => {
          const track = api.tracks.track(node);
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
              const entry = facts?.[index];
              const wanted = nextTrackValue(armBase(track.arm, entry), value);
              const objection = factsRefusal(entry, wanted);
              if (objection) {
                outcomes.push({ path: node.path, ok: false, message: objection });
                return;
              }
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
      // With the script's facts, the script's read after the write decides.
      if (prop === "arm" && facts) await verifyWithScript(api, written, outcomes, api.bridge);

      // Chains: their own switch through the bridge, after the tracks are done.
      const byTarget: TargetOutcome[] = new Array(targets.length);
      trackSlots.forEach((slot, k) => (byTarget[slot] = outcomes[k]!));
      if (chainSlots.length > 0 && prop !== "arm") {
        const chainNodes = chainSlots.map((i) => targets[i]!);
        const results = await setChainSwitch(api.bridge, chainNodes, prop, value);
        chainSlots.forEach((slot, k) => {
          const r = results[k]!;
          const path = targets[slot]!.path;
          byTarget[slot] = r.ok
            ? { path, ok: true }
            : { path, ok: false, ...(r.code !== undefined ? { code: r.code } : {}), message: r.message ?? "failed" };
        });
      }
      const all = byTarget.filter((o) => o !== undefined);

      const failed = all.filter((o) => !o.ok);
      if (failed.length === 0) return ok();
      // Only the script is missing/outdated/refusing: say so with exit code 5.
      const code =
        failed.length === all.length && failed.every((o) => o.code === ExitCode.UNAVAILABLE)
          ? ExitCode.UNAVAILABLE
          : ExitCode.FAILURE;
      return fail(code, `${name}: ${all.length - failed.length} of ${all.length} done`, all);
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
 * turn a value that did not take into a failed target. The SDK's value is
 * known to be wrong for a track Live refused to arm, so with the script the
 * script's verify (verifyWithScript) is the real check; this stays the only one
 * without the script.
 */
function verifyArm(api: ModuleApi, written: WrittenArm[], outcomes: TargetOutcome[]): void {
  for (const w of written) {
    const outcome = outcomes[w.outcome];
    if (!outcome || !outcome.ok) continue; // a write that threw is already a failure
    try {
      const track = api.tracks.track(w.node);
      if (track) api.log(armReadBackLine(w.node.path, w.wanted, track.arm));
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

/**
 * Ask the script what Live reads after the write. A track that does not read
 * what was written is a failure, and the SDK — which still holds the written
 * value — is corrected to the script's value in a second transaction (a second
 * undo step, but never a wrong state). An unanswered track is no objection.
 */
async function verifyWithScript(
  api: ModuleApi,
  written: WrittenArm[],
  outcomes: TargetOutcome[],
  bridge: Bridge,
): Promise<void> {
  const pending = written.filter((w) => outcomes[w.outcome]?.ok);
  if (pending.length === 0) return;
  const verdicts = await verifyArmWrites(
    bridge,
    pending.map((w) => ({ node: w.node, wanted: w.wanted })),
  );
  const corrections: Array<{ node: ObjectNode; actual: boolean }> = [];
  verdicts.forEach((verdict, i) => {
    const w = pending[i]!;
    api.log(armVerifyLine(w.node.path, w.wanted, verdict));
    if (verdict.state !== "mismatch") return;
    outcomes[w.outcome] = { path: w.node.path, ok: false, message: armNotChangedText(w.wanted) };
    corrections.push({ node: w.node, actual: verdict.actual ?? false });
  });
  if (corrections.length === 0) return;
  try {
    api.tracks.transaction(() => {
      for (const c of corrections) {
        try {
          const track = api.tracks.track(c.node);
          if (track) track.arm = c.actual;
        } catch {
          /* leave this track; the failure is reported anyway */
        }
      }
    });
  } catch {
    /* the report is what matters */
  }
}
