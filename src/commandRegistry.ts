import { ExitCode, fail, ok, type CommandResult, type FlagDef } from "./types.js";

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

  list(): CommandDef[] {
    return [...this.defs];
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
