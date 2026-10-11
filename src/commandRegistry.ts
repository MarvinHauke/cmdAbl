import { ExitCode, fail, ok, type CommandResult, type FlagDef } from "./types.js";
import { validateTree, type CommandNode } from "./core/commandTree.js";
import type { ArgValue } from "./core/resolveArgs.js";

/** A declared command: parsed and resolved by the platform before `run` is called. */
export type Command = CommandNode<void, ArgValue>;

export interface CommandDef {
  name: string;
  description: string;
  flags?: FlagDef[];
}

/** A handler may return a result, or nothing (= silent success). */
export type CommandHandler = (flags: string[]) => CommandResult | void | Promise<CommandResult | void>;

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly defs: CommandDef[] = [];
  private readonly tree: Command[] = [];

  /**
   * Add a declared command (or a group of subcommands). A node that breaks the
   * tree rules is rejected and reported rather than thrown: an exception here
   * would take the whole Extension Host down with it.
   */
  add(node: Command): string[] {
    const problems = validateTree([...this.tree, node]);
    if (this.handlers.has(node.name)) problems.push(`top level: "${node.name}" is already registered`);
    if (problems.length) {
      console.error(`cmdAbl: command "${node.name}" was not registered:\n  ${problems.join("\n  ")}`);
      return problems;
    }
    this.tree.push(node);
    return [];
  }

  /** The declared command tree. */
  roots(): Command[] {
    return this.tree;
  }

  /** True for commands registered through the older `register()` call. */
  isLegacy(name: string): boolean {
    return this.handlers.has(name);
  }

  // Overload: with flags
  register(name: string, description: string, flags: FlagDef[], handler: CommandHandler): void;
  // Overload: without flags
  register(name: string, description: string, handler: CommandHandler): void;
  register(
    name: string,
    description: string,
    flagsOrHandler: FlagDef[] | CommandHandler,
    handler?: CommandHandler,
  ): void {
    if (Array.isArray(flagsOrHandler)) {
      this.handlers.set(name, handler!);
      this.defs.push({ name, description, flags: flagsOrHandler });
    } else {
      this.handlers.set(name, flagsOrHandler);
      this.defs.push({ name, description });
    }
  }

  /** Every top-level command, however it was registered. */
  list(): CommandDef[] {
    return [...this.defs, ...this.tree.map((node) => ({ name: node.name, description: node.summary }))];
  }

  /**
   * Run a command by name with already-parsed flags. Always resolves — an unknown
   * command or a throwing handler becomes a failing result, never an exception.
   */
  async run(name: string, flags: string[] = []): Promise<CommandResult> {
    const handler = this.handlers.get(name);
    if (!handler) return fail(ExitCode.NOT_FOUND, `unknown command: "${name}"`);
    try {
      return (await handler(flags)) ?? ok();
    } catch (e: unknown) {
      return fail(ExitCode.FAILURE, `${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Parse a raw "name --flag" string and run it. */
  async execute(input: string): Promise<CommandResult> {
    const tokens = input.trim().split(/\s+/);
    return this.run(tokens[0] ?? "", tokens.slice(1));
  }
}
