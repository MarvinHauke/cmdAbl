export type CommandHandler = () => void | Promise<void>;

export interface CommandDef {
  name: string;
  description: string;
}

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly defs: CommandDef[] = [];

  register(name: string, description: string, handler: CommandHandler): void {
    this.handlers.set(name, handler);
    this.defs.push({ name, description });
  }

  list(): CommandDef[] {
    return [...this.defs];
  }

  async execute(input: string): Promise<void> {
    const name = input.trim();
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`unknown command: "${name}"`);
    await handler();
  }
}
