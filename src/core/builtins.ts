import type { CommandRegistry } from "../commandRegistry.js";
import { runSetup } from "../setup.js";
import { ok, fail, ExitCode } from "../types.js";
import { reportBridge, type BridgeProbe } from "./bridgeStatus.js";

// The only commands baked into cmdAbl itself — what a first-time user needs
// before any module is involved. Everything else is a module
// (src/modules/index.ts). Keep this file small on purpose.

const CMDABL_FLAGS = [
  { name: "--setup", description: "install keyboard trigger rule (Karabiner on macOS, AutoHotkey on Windows)" },
  { name: "--bridge", description: "show the Remote Script status (version, response time)" },
  { name: "--help", description: "show this usage text" },
];

/** Usage text generated from the registered flag list. */
export function cmdablUsage(): string {
  const width = Math.max(...CMDABL_FLAGS.map((f) => f.name.length));
  const lines = CMDABL_FLAGS.map((f) => `  ${f.name.padEnd(width)}  ${f.description}`);
  return [
    "usage: cmdabl <flag>",
    "",
    ...lines,
    "",
    "Documentation: man cmdabl · all commands: help",
  ].join("\n");
}

export interface BuiltinsDeps {
  /** The Remote Script bridge, for `cmdabl --bridge`. */
  bridge?: () => BridgeProbe;
}

export function registerBuiltins(registry: CommandRegistry, deps: BuiltinsDeps = {}): void {
  registry.register("help", "list the available commands", () => {
    const lines = registry
      .list()
      .map((def) => `${def.name.padEnd(12)} ${def.description}`)
      .sort();
    return ok(lines.join("\n"));
  });

  registry.register(
    "cmdabl",
    "configure cmdAbl",
    CMDABL_FLAGS,
    async (flags) => {
      if (flags.includes("--setup")) return ok(runSetup());
      if (flags.includes("--bridge")) {
        if (!deps.bridge) return fail(ExitCode.UNAVAILABLE, "the Remote Script bridge is not available in this build");
        // One fresh ping, answered at once: a dialog cannot show progress, and the
        // 20-round-trip measurement (GET /bridge) takes seconds.
        return (await reportBridge(deps.bridge(), undefined, { roundTrips: 1 })).result;
      }
      if (flags.includes("--help")) return ok(cmdablUsage());
      const unknown = flags.find((f) => f.startsWith("-"));
      return fail(ExitCode.USAGE, `${unknown ? `unknown flag "${unknown}"\n` : ""}${cmdablUsage()}`);
    },
  );
}
