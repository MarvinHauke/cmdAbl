import type { ModuleApi } from "../types.js";
import { ExitCode, fail, type CommandResult } from "../../types.js";
import { openUrl } from "../../core/openUrl.js";
import { findTopic, topicList } from "./topics.js";

/** `man <topic>` — open a manual in the browser: `man ableton`, `man cmdabl`. */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "man",
    summary: "open a manual: ableton, cmdabl",
    // Optional so a bare `man` gets a usage message that lists the topics.
    args: [{ name: "topic", kind: "text", required: false }],
    run: async (invocation): Promise<CommandResult> => {
      const topic = invocation.args[0]?.[0] as string | undefined;
      if (topic === undefined || topic === "") {
        return fail(ExitCode.USAGE, `usage: man <topic>\ntopics: ${topicList()}`);
      }
      const entry = findTopic(topic);
      if (!entry) return fail(ExitCode.NOT_FOUND, `no manual for "${topic}"\ntopics: ${topicList()}`);
      return openUrl(entry.url);
    },
  });
}
