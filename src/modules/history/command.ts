import type { Command } from "../../core/commandRegistry.js";
import type { CommandResult } from "../../core/types.js";

/** What the `history` subcommands do; `index.ts` supplies the real ones. */
export interface HistoryHandlers {
  clear(force: boolean): Promise<CommandResult | void>;
  forget(count: number | undefined): Promise<CommandResult | void>;
  restore(count: number | undefined): Promise<CommandResult | void>;
}

const countOf = (options: Record<string, string | true>): number | undefined => {
  const text = options.count;
  return typeof text === "string" ? Number(text) : undefined;
};

const COUNT = {
  name: "count",
  short: "n",
  takesValue: true,
  number: { min: 1, max: 20, integer: true },
};

/**
 * `history` as a group on the command tree (a bare `history` is the platform's
 * usage). The palette's re-runnable history rows come from a provider.
 *   history clear [-f] · forget [-n N] · restore [-n N]
 */
export function historyCommand(h: HistoryHandlers): Command {
  return {
    name: "history",
    summary: "manage the list of recent commands",
    description:
      "cmdAbl remembers the commands you ran and offers them as rows in the empty palette. " +
      "These subcommands clear the list, drop the newest entries or bring removed ones back. " +
      "The list and the removed entries live in memory and are gone when cmdAbl restarts.",
    children: [
      {
        name: "clear",
        summary: "remove all entries (asks first)",
        description:
          "Removes every entry from the history after a question. Removed entries can be brought back " +
          "with history restore until cmdAbl restarts. With --force there is no question and nothing " +
          "can be restored.",
        examples: [
          { line: "history clear", note: "ask, then move all entries aside" },
          { line: "history clear --force", note: "wipe the history for good, without asking" },
        ],
        options: [{ name: "force", short: "f", summary: "do not ask, and drop the removed entries too" }],
        run: (inv) => h.clear(inv.options.force === true),
      },
      {
        name: "forget",
        summary: "remove the newest entries",
        description:
          "Removes the newest entry, or the newest N with -n, without asking. Useful after a mistyped " +
          "command. history restore brings them back until cmdAbl restarts.",
        examples: [
          { line: "history forget", note: "drop the last command" },
          { line: "history forget -n 3", note: "drop the last three commands" },
        ],
        options: [{ ...COUNT, summary: "how many of the newest entries to remove (default 1)" }],
        run: (inv) => h.forget(countOf(inv.options)),
      },
      {
        name: "restore",
        summary: "bring removed entries back",
        description:
          "Puts entries removed by history clear or history forget back, most recently removed first. " +
          "Without -n it restores everything the last clear or forget removed. Entries keep their " +
          "original order; one that is already in the history again is not added twice.",
        examples: [
          { line: "history restore", note: "undo the last clear or forget" },
          { line: "history restore -n 2", note: "bring back the two most recently removed entries" },
        ],
        options: [{ ...COUNT, summary: "how many removed entries to bring back (default: all of the last clear or forget)" }],
        run: (inv) => h.restore(countOf(inv.options)),
      },
    ],
  };
}
