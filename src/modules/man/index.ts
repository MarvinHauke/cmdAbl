import type { ModuleApi } from "../types.js";
import { ExitCode, fail, type CommandResult } from "../../types.js";
import { openUrl } from "../../core/openUrl.js";
import { findTopic, topicList } from "./topics.js";

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
    // Optional so a bare `man` gets a usage message that lists the topics.
    args: [
      { name: "topic", kind: "text", required: false },
      { name: "words", kind: "text", required: false, rest: true },
    ],
    run: async (invocation): Promise<CommandResult> => {
      const topic = invocation.args[0]?.[0] as string | undefined;
      if (topic === undefined || topic === "") {
        return fail(ExitCode.USAGE, `usage: man <topic> [words]\ntopics: ${topicList()}`);
      }
      const entry = findTopic(topic);
      if (!entry) return fail(ExitCode.NOT_FOUND, `no manual for "${topic}"\ntopics: ${topicList()}`);
      const words = invocation.args[1]?.[0] as string | undefined;
      if (words === undefined || words.trim() === "") return openUrl(entry.url);
      if (!entry.search) {
        return fail(ExitCode.USAGE, `${topic.toLowerCase()} has no search; try: man ${topic.toLowerCase()}`);
      }
      return openUrl(entry.search([words]));
    },
  });
}
