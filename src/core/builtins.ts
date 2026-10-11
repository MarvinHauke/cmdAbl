import { spawn } from "node:child_process";
import { childEnv } from "./childEnv.js";
import type { CommandRegistry } from "../commandRegistry.js";
import { runSetup } from "../setup.js";
import { ok, fail, ExitCode, type CommandResult } from "../types.js";

// The only commands baked into cmdAbl itself — what a first-time user needs
// before any module is involved. Everything else is a module
// (src/modules/index.ts). Keep this file small on purpose.

/**
 * Open a URL in the default browser. Only macOS has a launcher we can rely on
 * (`open`); elsewhere the URL is handed to the user. A launch that fails is a
 * result, never an unhandled "error" event (which would take down the host).
 */
function openUrl(url: string): Promise<CommandResult> {
  if (process.platform !== "darwin") {
    return Promise.resolve(fail(ExitCode.UNAVAILABLE, `cannot open a browser here; open it by hand: ${url}`));
  }
  return new Promise((resolve) => {
    try {
      const child = spawn("open", [url], { detached: true, stdio: "ignore", env: childEnv() });
      child.once("error", (e) => resolve(fail(ExitCode.FAILURE, `cannot open ${url}: ${e.message}`)));
      child.once("spawn", () => {
        child.unref();
        resolve(ok());
      });
    } catch (e: unknown) {
      resolve(fail(ExitCode.FAILURE, `cannot open ${url}: ${e instanceof Error ? e.message : String(e)}`));
    }
  });
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
    [
      { name: "--setup", description: "install keyboard trigger rule (Karabiner on macOS, AutoHotkey on Windows)" },
      { name: "--help", description: "open the Ableton Live manual" },
    ],
    (flags) => {
      if (flags.includes("--setup")) return ok(runSetup());
      if (flags.includes("--help")) {
        return openUrl("https://www.ableton.com/en/manual/");
      }
      return fail(ExitCode.USAGE, "no recognised flag. Try: cmdabl --setup");
    },
  );
}
