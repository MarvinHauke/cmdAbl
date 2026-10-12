import type { Command } from "../../commandRegistry.js";
import type { CommandResult } from "../../types.js";

/** What the `pakabl` subcommands do; `index.ts` supplies the real ones. */
export interface PakablHandlers {
  install(id: string | undefined): Promise<CommandResult | void>;
  uninstall(id: string | undefined): Promise<CommandResult | void>;
  update(): Promise<CommandResult | void>;
  upgrade(ref: string | undefined): Promise<CommandResult | void>;
  list(): Promise<CommandResult | void>;
}

const firstArg = (inv: { args: unknown[][] }): string | undefined => inv.args[0]?.[0] as string | undefined;

/**
 * `pakabl` as a group on the command tree: the platform parses it, generates
 * `pakabl --help`, and answers a bare `pakabl` and an unknown subcommand
 * (exit 2) itself.
 *   pakabl install <id> · uninstall <id> · update · upgrade <id>[@<version>] · list
 */
export function pakablCommand(h: PakablHandlers): Command {
  return {
    name: "pakabl",
    summary: "install and manage cmdAbl extensions",
    children: [
      {
        name: "install",
        summary: "download and install an extension from the curated index",
        args: [{ name: "id", kind: "text" }],
        run: (inv) => h.install(firstArg(inv)),
      },
      {
        name: "uninstall",
        summary: "remove an installed extension",
        destructive: true,
        args: [{ name: "id", kind: "text" }],
        run: (inv) => h.uninstall(firstArg(inv)),
      },
      {
        name: "update",
        summary: "refresh the curated index",
        run: () => h.update(),
      },
      {
        name: "upgrade",
        summary: "install the index's version of an extension (<id>@<version> checks the version)",
        args: [{ name: "ref", kind: "text" }],
        run: (inv) => h.upgrade(firstArg(inv)),
      },
      {
        name: "list",
        summary: "browse the curated extensions and install or remove them",
        run: () => h.list(),
      },
    ],
  };
}
