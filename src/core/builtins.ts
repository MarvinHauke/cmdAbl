import { spawn } from "node:child_process";
import type { CommandRegistry } from "../commandRegistry.js";
import { runSetup } from "../setup.js";
import { ok, fail, ExitCode } from "../types.js";

// The only commands baked into cmdAbl itself — what a first-time user needs
// before any module is involved. Everything else is a module
// (src/modules/index.ts). Keep this file small on purpose.

export function registerBuiltins(registry: CommandRegistry): void {
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
    [
      { name: "--setup", description: "install keyboard trigger rule (Karabiner on macOS, AutoHotkey on Windows)" },
      { name: "--help", description: "open the Ableton Live manual" },
    ],
    (flags) => {
      if (flags.includes("--setup")) return ok(runSetup());
      if (flags.includes("--help")) {
        spawn("open", ["https://www.ableton.com/en/manual/"], { detached: true, stdio: "ignore" }).unref();
        return;
      }
      return fail(ExitCode.USAGE, "no recognised flag. Try: cmdabl --setup");
    },
  );
}
