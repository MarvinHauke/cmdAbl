import type { ModuleApi } from "../types.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { behindSongEnd, friendlyRefusal } from "../shared/position.js";
import { parseTarget, resolveTarget, stepBeats, STEP_CHOICES } from "./logic.js";

const NO_SCRIPT = "the Remote Script did not answer (is it running, and up to date?)";

/**
 * `jump <pos>` — move the playhead (plan 0027): `12.3.1`, `12`, `+4` / `-4` (bars from the current bar), `start`, `end`.
 * Bar positions use the Set's current time signature. Playback keeps running.
 */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "jump",
    topic: "Look things up",
    summary: "move the playhead to a position",
    description:
      "Moves the Arrangement playhead (playing stays playing). jump 12.3.1 goes to bar 12, beat 3, sixteenth 1; jump 12 to the start of bar 12; " +
      "jump +4 or jump -4 moves by steps from the start of the current step (not before the start); a step is Live's global launch quantization unless jump config sets another size (1 bar when Live's is None); jump +2b moves by bars and jump +3q by quarters (to go back, put -- first: jump -- -3q); jump start goes to the beginning, " +
      "jump end to the length Live reports for the Set (Live counts the loop end in it). Positions use the Set's current time signature, " +
      "so they are off in Sets whose signature changes. Needs the cmdAbl Remote Script.",
    examples: [
      { line: "jump 12.3.1", note: "to bar 12, beat 3, sixteenth 1" },
      { line: "jump 12", note: "to the start of bar 12" },
      { line: "jump +4", note: "four steps on (see jump config)" },
      { line: "jump +2b", note: "two bars on" },
      { line: "jump +3q", note: "three quarters on (back: jump -- -3q)" },
      { line: "jump start", note: "back to the beginning" },
    ],
    requires: ["bridge"],
    args: [{ name: "position", kind: "text", required: true, summary: "12.3.1, 12, +4, -4, +2b, +3q, start or end" }],
    run: async (invocation): Promise<CommandResult> => {
      const given = String(invocation.args[0]?.[0] ?? "");
      const target = parseTarget(given);
      if (target === null) return fail(ExitCode.USAGE, `jump: "${given}" is not a position (12.3.1, 12, +4, -4, start, end)`);
      const t = await api.set.transport();
      if (t === null) return fail(ExitCode.UNAVAILABLE, `jump: ${NO_SCRIPT}`);
      // Only a plain +N / -N needs the step size.
      const step = target.kind === "relative" && target.unit === "step"
        ? stepBeats((await api.settings.get<string>("step")) ?? "live", t.quantizationBeats, t.barLen)
        : undefined;
      const r = resolveTarget(target, { num: t.sigNum, den: t.sigDen, barStart: t.barStart, barLen: t.barLen, songLength: t.songLength, time: t.time, step });
      if (!r.ok) return fail(r.code === 5 ? ExitCode.UNAVAILABLE : ExitCode.USAGE, `jump: ${r.text}`);
      const behind = behindSongEnd(r.time, t.songLength, { num: t.sigNum, den: t.sigDen });
      if (behind !== null) return fail(ExitCode.FAILURE, `jump: ${behind}`);
      const moved = await api.set.jump(r.time);
      if (!moved.ok) {
        if (friendlyRefusal(moved.text) !== moved.text) api.logger.debug(`jump: ${moved.text}`);
        return fail(moved.code === 5 ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `jump: ${friendlyRefusal(moved.text)}`);
      }
      if (moved.note) api.logger.debug(`jump: ${moved.note}`);
      return { ...ok(), log: [`jump: to ${r.text} (${r.time} beats)`] };
    },
  });

  api.settings.declare({
    heading: "Jump",
    items: [
      {
        key: "jump.step",
        label: "Step size of jump +N / -N",
        help: "How far jump +N and jump -N move per step. Live's launch quantization follows the Set's global setting (1 bar when it is None). jump +2b counts bars and jump +3q quarters whatever is set here.",
        kind: "enum",
        default: "live",
        choices: STEP_CHOICES.map((c) => ({ value: c.value, label: c.label })),
      },
    ],
  });
}
