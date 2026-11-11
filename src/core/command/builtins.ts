import type { CommandRegistry } from "./commandRegistry.js";
import { setupCommand, type SetupCommandDeps } from "../setup/command.js";
import { configCommand, registerConfigCompleters, type ConfigCommandDeps } from "../settings/command.js";
import { logCommand, type LogCommandDeps } from "../host/logCommand.js";
import { curveCommand, type CurveCommandDeps } from "../host/curveCommand.js";
import { bridgeCommand, type BridgeCommandDeps } from "../host/bridgeCommand.js";

// The only commands baked into cmdAbl itself — what a first-time user needs
// before any module is involved. Everything else is a module
// (src/modules/index.ts). Keep this file small on purpose: it only assembles (`help` is in the man module). `cmdabl` is a group
// whose subcommands live in their areas' folders (setup/command.ts, settings/command.ts,
// host/logCommand.ts, host/curveCommand.ts, host/bridgeCommand.ts); its usage text is generated from the tree.

export interface BuiltinsDeps extends SetupCommandDeps, ConfigCommandDeps, LogCommandDeps, CurveCommandDeps, BridgeCommandDeps {}

export function registerBuiltins(registry: CommandRegistry, deps: BuiltinsDeps = {}): void {
  registerConfigCompleters(registry, deps);

  registry.add({
    name: "cmdabl",
    topic: "cmdAbl itself",
    summary: "configure cmdAbl",
    description: "Setup and status commands of cmdAbl itself.",
    children: [setupCommand(deps), configCommand(deps), logCommand(deps), curveCommand(deps), bridgeCommand(deps)],
  });
}
