import { ok, fail, ExitCode } from "../types.js";
import type { Command, CommandRegistry } from "../command/commandRegistry.js";
import type { SettingsFlow } from "../surfaces/settingsSurface.js";
import type { DefaultsFlow } from "../surfaces/defaultsSurface.js";

// `cmdabl config` (plan 0019): the settings page and the defaults page.

export interface ConfigCommandDeps {
  /** The settings page, for `cmdabl config` (plan 0019); absent: it answers exit 5. */
  settings?: Pick<SettingsFlow, "open" | "groups">;
  /** The defaults page, for `cmdabl config defaults [<command>]` (plan 0019 §7); absent: it answers exit 5. */
  defaults?: Pick<DefaultsFlow, "open">;
}

/** The completers `cmdabl config` uses: the group ids (core's first, then the modules') and the commands a default can be set for. */
export function registerConfigCompleters(registry: CommandRegistry, deps: ConfigCommandDeps): void {
  registry.completer("settings-groups", () => [
    ...(deps.settings?.groups() ?? []).map((g) => ({ label: g.id, description: g.heading })),
    { label: "defaults", description: "default commands: what a bare command word runs" },
  ]);
  registry.completer("default-commands", () => registry.list().map((c) => ({ label: c.name, description: c.description })));
}

export function configCommand(deps: ConfigCommandDeps): Command {
  return {
    name: "config",
    summary: "open the settings of cmdAbl and its modules",
    description:
      "Opens the Settings page: one group per module that declares settings (cmdAbl, MIDI mapping, tag, …), core's first. " +
      "Change values with the keys (↑/↓ rows, ←/→ a choice or number, Space a switch) and press Enter to save; Esc leaves without saving. " +
      "With a group the page opens on it. `cmdabl config defaults [<command>]` opens the default commands (a bare command word runs the line you choose). <command> config (tag config, mute config, …) works for every command except man and help (`man config` looks the word up) and shows just that command's settings (at least its default command); " +
      "`config` right after such a command is this word now, so to name a track called config, quote it (tag \"config\").",
    examples: [
      { line: "cmdabl config", note: "all settings" },
      { line: "cmdabl config tag", note: "open on the tag group" },
      { line: "cmdabl config defaults", note: "the default commands: what a bare mute, solo, note … runs" },
      { line: "cmdabl config defaults mute", note: "open on the row of mute" },
    ],
    args: [
      { name: "group", kind: "text", required: false, complete: "settings-groups", summary: "a group to open on (a module's name), or defaults" },
      { name: "command", kind: "text", required: false, complete: "default-commands", summary: "with defaults: the command whose row to open on" },
    ],
    run: async (invocation) => {
      const group = invocation.args[0]?.[0];
      const command = invocation.args[1]?.[0];
      if (group === "defaults") {
        if (!deps.defaults) return fail(ExitCode.UNAVAILABLE, "config: the default commands are not available in this build");
        return deps.defaults.open(typeof command === "string" ? { focus: command } : {});
      }
      if (command !== undefined) return fail(ExitCode.USAGE, "config: a second word is only for `config defaults <command>`");
      if (!deps.settings) return fail(ExitCode.UNAVAILABLE, "config: the settings are not available in this build");
      return deps.settings.open(typeof group === "string" ? { group } : {});
    },
  };
}
