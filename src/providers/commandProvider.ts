import type { Provider, PaletteItem } from "../types.js";
import type { CommandRegistry } from "../commandRegistry.js";

/**
 * Exposes registered commands as palette items. Execution still goes through
 * the registry; this provider only contributes the searchable entries.
 */
export function createCommandProvider(registry: CommandRegistry): Provider {
  return {
    getItems(): PaletteItem[] {
      return registry.list().map((def) => ({
        id: def.name,
        type: "command" as const,
        title: def.name,
        subtitle: def.description,
        flags: def.flags,
      }));
    },
  };
}
