import { logger } from "./log.js";
import { unknownCompleterKeys, validateTree, type CommandNode } from "./commandTree.js";
import type { Completer } from "./complete.js";
import type { ArgValue } from "./resolveArgs.js";

/** A declared command: parsed and resolved by the platform before `run` is called. */
export type Command = CommandNode<void, ArgValue>;

/** What the palette and `help` show for a top-level command. */
export interface CommandDef {
  name: string;
  description: string;
  /** The topic the command is listed under (see `CommandNode.topic`). */
  topic?: string;
}

/**
 * The declared command tree. Every command — core's and the modules' — is a
 * node added here; there is no other registration path.
 */
export class CommandRegistry {
  private readonly tree: Command[] = [];
  private readonly sources = new Map<string, Completer>();

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

  /**
   * Register a completer under a key (`api.commands.completer`). A key given twice keeps the first
   * and logs a warning; a non-function or empty key is ignored with a warning. Never throws.
   */
  completer(key: string, source: Completer): void {
    if (typeof key !== "string" || key.trim() === "" || typeof source !== "function") {
      logger("registry").warn("completer ignored: it needs a key and a function");
      return;
    }
    if (this.sources.has(key)) {
      logger("registry").warn(`completer "${key}" is already registered; the first one stays`);
      return;
    }
    this.sources.set(key, source);
  }

  /** The registered completers, by key. */
  completers(): ReadonlyMap<string, Completer> {
    return this.sources;
  }

  /** Nodes that name a completer key nobody registered, as readable lines (checked once after activation). */
  unknownCompleters(): string[] {
    return unknownCompleterKeys(this.tree, this.sources.keys());
  }

  /** The declared command tree. */
  roots(): Command[] {
    return this.tree;
  }

  /** Every top-level command. */
  list(): CommandDef[] {
    return this.tree.map((node) => ({ name: node.name, description: node.summary, ...(node.topic ? { topic: node.topic } : {}) }));
  }
}
