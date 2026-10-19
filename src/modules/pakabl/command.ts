import type { Command } from "../../core/commandRegistry.js";
import type { CommandResult } from "../../core/types.js";

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
    summary: "install and manage Ableton Live extensions",
    description:
      "Installs and manages community extensions for Ableton Live (.ablx files) from cmdAbl's curated list of " +
      "community repositories. Run pakabl update once to fetch " +
      "the list, then pakabl list to browse it. Restart Live after installing, upgrading or removing an extension.",
    children: [
      {
        name: "install",
        summary: "download and install an extension from the curated index",
        description:
          "Downloads one Ableton Live extension from the curated list and unpacks it into Live's Extensions folder. " +
          "Restart Live to load it. Run pakabl update first to fetch the list.",
        examples: [{ line: "pakabl install federico-pepe.snake", note: "install the extension with that id" }],
        args: [{ name: "id", kind: "text", summary: "Extension id as shown by pakabl list: author.name" }],
        run: (inv) => h.install(firstArg(inv)),
      },
      {
        name: "uninstall",
        summary: "remove an installed extension",
        description:
          "Deletes an installed extension from Live's Extensions folder. Restart Live to unload it.",
        examples: [{ line: "pakabl uninstall federico-pepe.snake", note: "remove that extension" }],
        destructive: true,
        args: [{ name: "id", kind: "text", summary: "Extension id as shown by pakabl list: author.name" }],
        run: (inv) => h.uninstall(firstArg(inv)),
      },
      {
        name: "update",
        summary: "refresh the curated index",
        description:
          "Fetches the current curated list of extensions. Needed once before install, upgrade and list, " +
          "and again whenever you want to see new versions.",
        examples: [{ line: "pakabl update", note: "fetch the list" }],
        run: () => h.update(),
      },
      {
        name: "upgrade",
        summary: "install a newer index version of an extension (<id>@<version> installs that one even if not newer)",
        description:
          "Installs the version the curated list holds, but only when it is newer than the installed one; " +
          "otherwise nothing changes. Name the version after an @ to install it anyway, also an older or the same " +
          "one: the command stops when the list holds another version. Restart Live to reload it.",
        examples: [
          { line: "pakabl upgrade federico-pepe.snake", note: "install the list's version if it is newer" },
          { line: "pakabl upgrade federico-pepe.snake@1.2.0", note: "install the list's version 1.2.0, newer or not" },
        ],
        args: [
          {
            name: "ref",
            kind: "text",
            summary: "Extension id, optionally followed by @ and the version the list holds, to install it even if it is not newer",
          },
        ],
        run: (inv) => h.upgrade(firstArg(inv)),
      },
      {
        name: "list",
        summary: "browse the curated extensions and install or remove them",
        description:
          "Opens a window with the curated extensions. Each row has buttons to install, update or uninstall " +
          "it and to open its repository. Run pakabl update first to fetch the list.",
        examples: [{ line: "pakabl list", note: "browse the extensions" }],
        run: () => h.list(),
      },
    ],
  };
}
