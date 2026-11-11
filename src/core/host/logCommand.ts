import { ok } from "../types.js";
import type { Command } from "../command/commandRegistry.js";
import { appLog, clockText, dayText, type Log } from "../log.js";

// `cmdabl log`: the last lines of cmdAbl's log.

export interface LogCommandDeps {
  /** The log `cmdabl log` shows (default: the extension's). */
  log?: Pick<Log, "entries" | "setDebug" | "debugOn">;
}

export function logCommand(deps: LogCommandDeps): Command {
  return {
    name: "log",
    summary: "show the last lines of cmdAbl's log",
    description:
      "Shows the last 50 lines of the log, newest at the bottom: what commands ran, what changed and the undo lines " +
      "of tag writes (Cmd+Z does not undo tags). The log keeps the last 500 lines of this session. " +
      "--debug turns detail lines on for the rest of the session.",
    examples: [
      { line: "cmdabl log", note: "the last 50 lines" },
      { line: "cmdabl log -n 200", note: "more lines" },
      { line: "cmdabl log --undo", note: "only the commands that undo a change, one per line" },
      { line: "cmdabl log --debug", note: "turn on debug lines for this session" },
    ],
    options: [
      { name: "count", short: "n", takesValue: true, number: { min: 1, max: 500, integer: true }, summary: "show this many lines (default 50)" },
      { name: "undo", takesValue: false, summary: "only the commands that undo a change (the part after \"undo: \")" },
      { name: "debug", takesValue: false, summary: "turn debug lines on for this session" },
    ],
    run: (invocation) => {
      const log = deps.log ?? appLog;
      const turnedOn = invocation.options.debug === true && !log.debugOn();
      if (invocation.options.debug === true) log.setDebug(true);
      const count = invocation.options.count ? Number(invocation.options.count) : 50;
      const all = log.entries();
      const undoOnly = invocation.options.undo === true;
      let wanted: string[];
      if (undoOnly) {
        // just the commands that undo a change, without time, prefix, level, indentation or "undo: "
        wanted = all.flatMap((e) => {
          const m = /^cmdAbl \[[^\]]+\] info:\s+undo: (.+)$/.exec(e.line);
          const command = m ? m[1].trim() : "";
          return command === "" ? [] : [command];
        });
      } else {
        const last = all.slice(-count);
        const multiDay = new Set(last.map((e) => dayText(e.time))).size > 1;
        wanted = [];
        let day = "";
        for (const e of last) {
          if (multiDay && dayText(e.time) !== day) {
            day = dayText(e.time);
            wanted.push(day);
          }
          wanted.push(`${clockText(e.time)} ${e.line.replace(/^cmdAbl \[/, "[")}`);
        }
      }
      const shown = undoOnly ? wanted.slice(-count) : wanted;
      const note = turnedOn ? "debug lines are on for this session\n" : "";
      if (shown.length === 0) return ok(`${note}${invocation.options.undo === true ? "no undo commands logged yet" : "the log is empty"}`);
      return ok(`${note}${shown.join("\n")}`);
    },
  };
}
