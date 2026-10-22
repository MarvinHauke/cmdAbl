import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { quoteIfNeeded } from "../../core/tokenize.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../../core/types.js";
import { MAX_DB, MIN_FINITE_DB, valueToDb } from "../mixValue.js";
import { applyRelative, type RelativeRule } from "../relative.js";
import { faderMove, formatDb, formatSigned, parseDb, planAbsolute, type FaderPlan } from "./plan.js";

/**
 * `vol [--set | --clip] <dB> <target>…` — the fader level of tracks: relative by default (`vol -6 #drums` moves
 * every drums fader by 6 dB; a step that would push one past +6 dB or the lowest level is shortened for all of
 * them, so the balance stays), `--clip` lets each fader stop alone, `--set` is absolute (`vol --set -6 #drums`;
 * `-inf` is allowed). Through the SDK's mixer.volume, so the Remote Script is not needed. One undo step in
 * Live; the change and the line that puts it back go to the log. Plan 0012.
 */
export function activate(api: ModuleApi): void {
  const atEnd = (db: number) => (db === -Infinity ? "-inf" : db >= MAX_DB ? "+6 dB (the maximum)" : `${formatDb(db)} dB (the lowest step)`);

  api.commands.add({
    name: "vol",
    topic: "Mix",
    summary: "change the fader level of tracks, in dB",
    description:
      "Moves the volume fader of each target track by the given number of dB: vol -6 /Bass lowers it by 6 dB from where it is, " +
      "vol 2 #drums raises every drums fader by 2 dB, so the balance between them stays. If a step would push a fader past " +
      "Live's maximum, +6 dB, or below the lowest level, the step is shortened for every target, so they all move by the same " +
      "amount and keep their balance; the result then says how far they moved and which fader reached the end. With --clip " +
      "every fader follows the full step instead and the ones past an end stop there (below the lowest level a fader goes to -inf). " +
      "With --set the level is absolute: vol --set -6 #drums puts every fader at -6 dB, vol --set -inf /Bass silences it. A fader at " +
      "-inf stays there on a relative step, use --set to bring it back. This overwrites the fader and works against volume " +
      "automation. It works on tracks (including the return and main tracks, /Main), not yet on chains. A change that went as typed " +
      "shows nothing: the old and new level and the command that puts it back go to the log, and Cmd+Z undoes the whole command in one step. " +
      "Works without the Remote Script.",
    examples: [
      { line: "vol -6 /Bass", note: "lower the Bass fader by 6 dB" },
      { line: "vol 2 #drums", note: "raise every drums fader by 2 dB, or by less if one of them reaches +6 dB" },
      { line: "vol --clip 9 #drums", note: "raise every drums fader by 9 dB, each stopping at +6 dB" },
      { line: "vol --set -6 #drums", note: "put every drums fader at -6 dB" },
      { line: "vol --set 0 /Bass, /Lead", note: "both faders to 0 dB" },
      { line: "vol --set -inf /Lead", note: "silence the fader" },
    ],
    options: [
      { name: "set", short: "s", summary: "treat the number as the level to set, not a step from where the fader is" },
      { name: "clip", short: "c", summary: "let each fader follow the whole step and stop at an end alone, instead of shortening the step for all" },
    ],
    args: [
      { name: "dB", kind: "text", summary: "Level or step in dB: -6, +2, 0.5; -inf only with --set" },
      { name: "target", kind: "path", kinds: ["track", "chain"], variadic: true, summary: "Tracks to change; separate several with commas, or use #tag" },
    ],
    run: async (invocation): Promise<CommandResult> => {
      const text = String(invocation.args[0]?.[0] ?? "");
      const db = parseDb(text);
      if (db === null) return fail(ExitCode.USAGE, `vol: "${text}" is not a level in dB — use a number such as -6, +2 or 0.5, or -inf`);
      const absolute = invocation.options.set === true;
      const rule: RelativeRule = invocation.options.clip === true ? "clip" : "stop";
      if (absolute && invocation.options.clip === true) return fail(ExitCode.USAGE, "vol: --clip is for relative steps, it cannot go with --set");
      if (!absolute && db === -Infinity) return fail(ExitCode.USAGE, "vol: a step cannot be -inf — use vol --set -inf to silence a fader");
      const asked = (invocation.args[1] ?? []) as ObjectNode[];
      const chains = asked.filter((n) => n.kind !== "track");
      if (chains.length > 0) return fail(ExitCode.USAGE, `vol works on tracks for now, not on ${chains.map((n) => n.path).join(", ")}`);
      const seen = new Set<string>();
      const targets = asked.filter((n) => (seen.has(n.handleId) ? false : (seen.add(n.handleId), true)));

      // Read every fader first, then write them all in one transaction (one undo step).
      const olds = await Promise.all(targets.map((n) => api.tracks.volume(n)));
      const outcomes: TargetOutcome[] = [];
      const lines: string[] = [];
      const limits: string[] = []; // faders that stopped at an end (visible)
      const readable = targets.flatMap((node, i) => {
        const old = olds[i];
        if (old === null || old === undefined) {
          outcomes.push({ path: node.path, ok: false, code: ExitCode.NOT_FOUND, message: "the fader could not be read" });
          return [];
        }
        return [{ node, old, oldDb: valueToDb(old) }];
      });

      // What every fader does.
      const moves: Array<{ node: ObjectNode; plan: FaderPlan }> = [];
      const unmoved: ObjectNode[] = [];
      let notice: string | undefined;
      if (absolute) {
        for (const { node, old } of readable) {
          const plan = planAbsolute(old, db);
          if (plan.limit) limits.push(`${node.path} at ${plan.limit === "max" ? "+6 dB (the maximum)" : "-inf"}`);
          if (plan.same) unmoved.push(node);
          else moves.push({ node, plan });
        }
      } else {
        const result = applyRelative(readable.map((r) => r.oldDb), db, rule, { min: MIN_FINITE_DB, max: MAX_DB });
        lines.push(`vol ${text}: asked ${formatSigned(db)} dB, applied ${formatSigned(result.applied)} dB`);
        readable.forEach(({ node, old }, i) => {
          const plan = faderMove(old, result.newLevels[i]!);
          if (plan.same) unmoved.push(node);
          else moves.push({ node, plan });
        });
        const reached = result.limited.map((i) => readable[i]!.node.path);
        const end = result.limited.length > 0 ? atEnd(result.newLevels[result.limited[0]!]!) : "";
        if (rule === "clip") {
          for (const i of result.limited) limits.push(`${readable[i]!.node.path} at ${atEnd(result.newLevels[i]!)}`);
        } else if (db !== 0 && Math.abs(result.applied) < 0.05) {
          const stuck = readable.filter((r) => r.oldDb === -Infinity).map((r) => r.node.path);
          const who = reached.length > 0 ? reached : stuck;
          notice = `nothing changed: ${who.join(", ")} ${who.length === 1 ? "is" : "are"} at ${reached.length > 0 ? end : "-inf"}`;
          if (reached.length > 0 && db < 0) notice += " — use --clip or --set -inf to go lower";
        } else if (Math.abs(result.applied - db) > 1e-9 && result.limited.length > 0) {
          notice = `vol ${text}: moved ${formatSigned(result.applied)} dB, ${reached.join(", ")} reached ${end}`;
        }
      }
      for (const node of unmoved) {
        const r = readable.find((x) => x.node === node)!;
        lines.push(`${node.path}: ${formatDb(r.oldDb)} dB, no change`);
        outcomes.push({ path: node.path, ok: true });
      }

      let written: boolean[] = [];
      if (moves.length > 0) {
        await api.tracks.transaction(() => Promise.all(moves.map((m) => api.tracks.setVolume(m.node, m.plan.newValue))).then((r) => void (written = r)));
      }
      moves.forEach(({ node, plan }, i) => {
        if (written[i] !== true) {
          outcomes.push({ path: node.path, ok: false, code: ExitCode.FAILURE, message: "the fader could not be written" });
          return;
        }
        lines.push(
          `${node.path}: ${formatDb(plan.oldDb)} → ${formatDb(plan.newDb)} dB`,
          `  undo: vol --set ${formatDb(plan.oldDb)} ${quoteIfNeeded(node.path)}`,
        );
        outcomes.push({ path: node.path, ok: true });
      });

      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length > 0) {
        return { ...fail(ExitCode.FAILURE, `vol: ${outcomes.length - failed.length} of ${outcomes.length} done`, failed), log: lines };
      }
      if (notice) return { ...ok(notice), log: lines };
      if (limits.length > 0) return { ...ok(`limit reached: ${limits.join(", ")}`), log: lines };
      if (moves.length === 0) return { ...ok("nothing changed"), log: lines };
      return { ...ok(), log: lines };
    },
  });
}
