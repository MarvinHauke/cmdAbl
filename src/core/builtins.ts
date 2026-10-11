import type { CommandRegistry } from "../commandRegistry.js";
import { runSetup } from "../setup.js";
import { ok, fail, ExitCode } from "../types.js";

// The only commands baked into cmdAbl itself — what a first-time user needs
// before any module is involved. Everything else is a module
// (src/modules/index.ts). Keep this file small on purpose.

const CMDABL_FLAGS = [
  { name: "--setup", description: "install keyboard trigger rule (Karabiner on macOS, AutoHotkey on Windows)" },
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
    CMDABL_FLAGS,
    (flags) => {
      if (flags.includes("--setup")) return ok(runSetup());
      if (flags.includes("--help")) return ok(cmdablUsage());
      const unknown = flags.find((f) => f.startsWith("-"));
      return fail(ExitCode.USAGE, `${unknown ? `unknown flag "${unknown}"\n` : ""}${cmdablUsage()}`);
    },
  );
}
