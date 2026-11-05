import type { Command, CommandRegistry } from "./commandRegistry.js";

/** Commands that get no platform `config`: `man config` and `help config` look the word up as before (plan 0019, user decision). */
export const NO_PLATFORM_CONFIG: ReadonlySet<string> = new Set(["man", "help"]);

export interface AttachConfigDeps {
  /** The `config` subcommand for a top-level command. */
  make: (name: string) => Command;
  /** Names of the declared settings groups (a group should have a command of its name). */
  groups: () => string[];
  warn: (text: string) => void;
}

/**
 * `<command> config` for every top-level command except `man`/`help` (plan 0019 §2). `cmdabl config` is a real subcommand;
 * a command with its own `config` keeps it. Warns once for a declared group that has no command of its name
 * and for a group whose command could not take the platform `config`.
 */
export function attachConfigs(registry: CommandRegistry, deps: AttachConfigDeps): void {
  const groups = new Set(deps.groups());
  const names = registry.roots().map((n) => n.name);
  for (const name of names) {
    if (NO_PLATFORM_CONFIG.has(name)) continue;
    const attached = registry.attachConfig(name, deps.make(name));
    if (!attached && name !== "cmdabl" && groups.has(name)) {
      deps.warn(`group "${name}" could not get \`${name} config\` (the command has its own \`config\`)`);
    }
  }
  for (const id of groups) {
    if (!names.includes(id)) deps.warn(`group "${id}" has no command of that name; \`${id} config\` does not exist`);
  }
}
