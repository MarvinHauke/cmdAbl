import type { ModuleApi } from "../types.js";
import { ExitCode, fail, type CommandResult } from "../../types.js";
import { openUrl } from "../../core/openUrl.js";
import { findTopic, topicNames } from "./topics.js";

/**
 * `man <topic> [words]` — open a manual in the browser: `man ableton`,
 * `man cmdabl`. Words after a topic that has a search (`man ableton warp
 * modes`) open a web search scoped to that manual. The parser joins the words
 * with single spaces and drops quotes, so no exact-phrase search.
 */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "man",
    summary: "open a manual, or search it: ableton, cmdabl",
    description:
      "Opens a manual in your web browser: the Ableton Live reference manual or the cmdAbl documentation. " +
      "Words after ableton search the Live 12 manual through Ecosia. Needs an internet connection.",
    examples: [
      { line: "man ableton", note: "open the Live reference manual" },
      { line: "man ableton warp modes", note: "search the Live manual for \"warp modes\"" },
      { line: "man cmdabl", note: "open the cmdAbl documentation" },
    ],
    // The topic is an enum: a bare `man` or an unknown topic is the platform's
    // usage error (exit 2), which lists the choices. The words after it are a
    // separate rest argument.
    args: [
      {
        name: "topic",
        kind: "enum",
        choices: topicNames(),
        summary: "Which manual: ableton (Live reference manual) or cmdabl (this documentation)",
      },
      { name: "words", kind: "text", required: false, rest: true, summary: "What to search for; only for ableton" },
    ],
    run: async (invocation): Promise<CommandResult> => {
      const topic = invocation.args[0]?.[0] as string | undefined;
      const entry = topic === undefined ? undefined : findTopic(topic);
      if (topic === undefined || !entry) return fail(ExitCode.USAGE, `usage: man <topic> [words]`); // not reachable: the platform checks the choices
      const words = invocation.args[1]?.[0] as string | undefined;
      if (words === undefined || words.trim() === "") return openUrl(entry.url);
      if (!entry.search) {
        return fail(ExitCode.USAGE, `${topic} has no search; try: man ${topic}`);
      }
      return openUrl(entry.search([words]));
    },
  });
}
