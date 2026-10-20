import type { ModuleApi } from "../types.js";
import { ExitCode, fail, ok, type CommandResult } from "../../core/types.js";
import { openUrl } from "../../core/openUrl.js";
import { findTopic } from "./topics.js";
import { closeMatches, findNode, manPage } from "./page.js";

/**
 * `man <command…>` — the full page of a command inside Live, built from the
 * command tree; `man ableton [words]` and `man cmdabl` open the web manuals.
 * `cmdabl` alone is the docs site, `man cmdabl setup` the page of that
 * subcommand. The page goes through the message surface (multi-line text).
 */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "man",
    summary: "show a command's page, or open a manual: ableton, cmdabl",
    description:
      "Shows the full page of a command inside Live, offline: summary, usage, subcommands, options, arguments and " +
      "examples, as in the command reference, plus the web address of its section. Name a subcommand too: man history clear. " +
      "man ableton opens the Live reference manual (words after it search the Live 12 manual through Ecosia), " +
      "man cmdabl opens the cmdAbl documentation. The web manuals need an internet connection.",
    examples: [
      { line: "man tag", note: "show the page of the tag command" },
      { line: "man history clear", note: "show the page of a subcommand" },
      { line: "man cmdabl setup", note: "show the page of cmdabl setup" },
      { line: "man ableton warp modes", note: "search the Live manual for \"warp modes\"" },
      { line: "man cmdabl", note: "open the cmdAbl documentation" },
    ],
    // Variadic: the platform tokenizes, so a name with spaces can be quoted.
    args: [
      {
        name: "command",
        kind: "text",
        variadic: true,
        summary: "A command, with its subcommand if it has one (man history clear); ableton [words] or cmdabl alone open the web manuals",
      },
    ],
    run: async (invocation): Promise<CommandResult> => {
      const words = (invocation.args[0] ?? []) as string[];
      const first = words[0]!.toLowerCase();

      if (first === "ableton") {
        const entry = findTopic("ableton")!;
        return words.length === 1 ? openUrl(entry.url) : openUrl(entry.search!(words.slice(1)));
      }
      if (first === "cmdabl" && words.length === 1) return openUrl(findTopic("cmdabl")!.url);

      const roots = api.commands.roots();
      const found = findNode(roots, words);
      const help = found ? api.commands.help(found.path) : undefined;
      if (found && help !== undefined) return ok(manPage(help, found.node, found.path));

      const near = closeMatches(roots, words);
      return fail(
        ExitCode.NOT_FOUND,
        `man: no command "${words.join(" ")}"` + (near.length ? `. Did you mean: ${near.join(", ")}?` : ""),
      );
    },
  });
}
