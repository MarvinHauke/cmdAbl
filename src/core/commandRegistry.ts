import { logger } from "./log.js";
import { validateTree, type CommandNode } from "./commandTree.js";
import type { ArgValue } from "./resolveArgs.js";

/** A declared command: parsed and resolved by the platform before `run` is called. */
export type Command = CommandNode<void, ArgValue>;

/** What the palette and `help` show for a top-level command. */
export interface CommandDef {
  name: string;
  description: string;
}

/**
 * The declared command tree. Every command — core's and the modules' — is a
 * node added here; there is no other registration path.
 */
export class CommandRegistry {
  private readonly tree: Command[] = [];

  /**
   * Add a declared command (or a group of subcommands). A node that breaks the
   * tree rules is rejected and reported rather than thrown: an exception here
   * would take the whole Extension Host down with it.
   */
  add(node: Command): string[] {
    const problems = validateTree([...this.tree, node]);
    if (problems.length) {
      logger("registry").error(`command "${node.name}" was not registered:\n  ${problems.join("\n  ")}`);
      return problems;
    }
    this.tree.push(node);
    return [];
  }

  /** The declared command tree. */
  roots(): Command[] {
    return this.tree;
  }

  /** Every top-level command. */
  list(): CommandDef[] {
    return this.tree.map((node) => ({ name: node.name, description: node.summary }));
  }
}
