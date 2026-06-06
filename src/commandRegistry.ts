import type { FlagDef } from "./types.js";

export interface CommandDef {
  name: string;
  description: string;
  flags?: FlagDef[];
}

export type CommandHandler = (flags: string[]) => void | Promise<void>;

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

  /** Run a command by name with already-parsed flags. */
  async run(name: string, flags: string[] = []): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`unknown command: "${name}"`);
    await handler(flags);
  }

  /** Parse a raw "name --flag" string and run it. */
  async execute(input: string): Promise<void> {
    const tokens = input.trim().split(/\s+/);
    await this.run(tokens[0] ?? "", tokens.slice(1));
  }
}
