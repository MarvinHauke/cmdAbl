import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { quoteIfNeeded } from "../../core/tokenize.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../../core/types.js";
import { formatDb, formatSigned, parseDb, planFader, type FaderPlan } from "./plan.js";

/**
 * `vol [--set] <dB> <target>…` — the fader level of tracks: relative by default (`vol -6 #drums` moves every
 * drums fader down by 6 dB), absolute with `--set` (`vol --set -6 #drums`; `-inf` is allowed). Through the SDK's
 * mixer.volume, so the Remote Script is not needed. One undo step in Live; the change and the line that puts it
 * back go to the log. Plan 0012.
 */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "vol",
    topic: "Mix",
    summary: "change the fader level of tracks, in dB",
    description:
      "Moves the volume fader of each target track by the given number of dB: vol -6 /Bass lowers it by 6 dB from where it is, " +
      "vol 2 #drums raises every drums fader by 2 dB, so the balance between them stays. With --set the level is absolute: " +
      "vol --set -6 #drums puts every fader at -6 dB, vol --set -inf /Bass silences it. A fader stops at Live's maximum, +6 dB, and at " +
      "-inf. When a relative step would push a fader past one of them, vol lists those tracks and asks first, because the balance " +
      "changes there; Cancel writes nothing. A fader already at -inf stays there on a relative step, use --set to bring it back. This overwrites the fader and works against volume automation. It works on tracks " +
      "(including the return and main tracks, /Main), not yet on chains. A successful change shows nothing: the old and new level " +
      "and the command that puts it back go to the log, and Cmd+Z undoes the whole command in one step. Works without the Remote Script.",
    examples: [
      { line: "vol -6 /Bass", note: "lower the Bass fader by 6 dB" },
      { line: "vol 2 #drums", note: "raise every drums fader by 2 dB" },
      { line: "vol --set -6 #drums", note: "put every drums fader at -6 dB" },
      { line: "vol --set 0 /Bass, /Lead", note: "both faders to 0 dB" },
      { line: "vol --set -inf /Lead", note: "silence the fader" },
    ],
    options: [{ name: "set", short: "s", summary: "treat the number as the level to set, not a step from where the fader is" }],
    args: [
      { name: "dB", kind: "text", summary: "Level or step in dB: -6, +2, 0.5, or -inf (with --set)" },
      { name: "target", kind: "path", kinds: ["track", "chain"], variadic: true, summary: "Tracks to change; separate several with commas, or use #tag" },
    ],
    run: async (invocation): Promise<CommandResult> => {
      const text = String(invocation.args[0]?.[0] ?? "");
      const db = parseDb(text);
      if (db === null) return fail(ExitCode.USAGE, `vol: "${text}" is not a level in dB — use a number such as -6, +2 or 0.5, or -inf`);
      const absolute = invocation.options.set === true;
      const asked = (invocation.args[1] ?? []) as ObjectNode[];
      const chains = asked.filter((n) => n.kind !== "track");
      if (chains.length > 0) return fail(ExitCode.USAGE, `vol works on tracks for now, not on ${chains.map((n) => n.path).join(", ")}`);
      const seen = new Set<string>();
      const targets = asked.filter((n) => (seen.has(n.handleId) ? false : (seen.add(n.handleId), true)));

      // Read every fader first, then write them all in one transaction (one undo step).
      const olds = await Promise.all(targets.map((n) => api.tracks.volume(n)));
      const outcomes: TargetOutcome[] = [];
      const moves: Array<{ node: ObjectNode; plan: FaderPlan }> = [];
      const lines: string[] = [];
      const limits: string[] = [];
      // A relative step that pushes a fader (not one already at -inf) past an end is asked about first.
      const pushed: Array<{ node: ObjectNode; plan: FaderPlan }> = [];
      targets.forEach((node, i) => {
        const old = olds[i];
        if (old === null || old === undefined) {
          outcomes.push({ path: node.path, ok: false, code: ExitCode.NOT_FOUND, message: "the fader could not be read" });
          return;
        }
        const plan = planFader(old, db, absolute);
        const where = `${node.path} at ${plan.limit === "max" ? "+6 dB (the maximum)" : "-inf"}`;
        if (plan.limit && !absolute && plan.oldDb !== -Infinity && !plan.same) pushed.push({ node, plan });
        else if (plan.limit) limits.push(where);
        if (plan.same) {
          lines.push(`${node.path}: ${formatDb(plan.oldDb)} dB, no change`);
          outcomes.push({ path: node.path, ok: true });
          return;
        }
        moves.push({ node, plan });
      });

      if (pushed.length > 0) {
        // The confirm title is one line in the pick list: a few tracks with where they end, the rest counted.
        const shown = pushed.slice(0, 3).map(({ node, plan }) => `${node.path} → ${plan.newDb === -Infinity ? "-inf" : `${formatSigned(plan.newDb)} dB`}`);
        const more = pushed.length > 3 ? `, +${pushed.length - 3} more` : "";
        const title = `vol ${text}: ${pushed.length} ${pushed.length === 1 ? "fader" : "faders"} would hit a limit and lose ${pushed.length === 1 ? "its" : "their"} balance — ${shown.join(", ")}${more}`;
        if (!(await api.confirm(title, "Apply anyway"))) return ok(); // cancelled: nothing written, quiet
        // The user agreed: no "limit reached" dialog afterwards, the full lines go to the log.
        for (const { node, plan } of pushed) {
          const to = plan.newDb === -Infinity ? "-inf" : `${formatSigned(plan.newDb)} dB`;
          lines.push(`limit reached: ${node.path}: ${formatSigned(plan.oldDb)} → ${to} (asked ${formatSigned(plan.askedDb)})`);
        }
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
      if (limits.length > 0) return { ...ok(`limit reached: ${limits.join(", ")}`), log: lines };
      if (moves.length === 0) return { ...ok("nothing changed"), log: lines };
      return { ...ok(), log: lines };
    },
  });
}
