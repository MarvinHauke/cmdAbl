import type { CommandRegistry } from "../commandRegistry.js";
import { SCRIPT_VERSION, type BridgeResult, type HelloInfo } from "../ableton/bridgeProtocol.js";
import { inspectInstalledScript, type InstalledScript } from "../ableton/installedScript.js";
import { runSetup } from "../setup.js";
import { ok, fail, ExitCode } from "../types.js";
import { reportBridge, type BridgeProbe } from "./bridgeStatus.js";
import { adviseRemoteScript } from "./setupAdvice.js";

// The only commands baked into cmdAbl itself — what a first-time user needs
// before any module is involved. Everything else is a module
// (src/modules/index.ts). Keep this file small on purpose. Both are declared
// on the command tree like any module's commands: `cmdabl` is a group
// (`setup`, `bridge`); its usage text is generated from the tree.

export interface BuiltinsDeps {
  /** The Remote Script bridge, for `cmdabl bridge` and the version check of `cmdabl setup`. */
  bridge?: () => BridgeProbe;
  /** Test hooks: what `cmdabl setup` does and looks at. */
  setup?: () => string;
  installed?: () => InstalledScript;
  shippedVersion?: string;
}

export function registerBuiltins(registry: CommandRegistry, deps: BuiltinsDeps = {}): void {
  registry.add({
    name: "help",
    summary: "list the available commands",
    description: "Prints every command with its one-line summary. Typing a command followed by --help shows that command in full.",
    examples: [{ line: "help", note: "list the commands" }, { line: "cmdabl --help", note: "usage of the cmdabl commands" }],
    run: () => {
      const lines = registry
        .list()
        .map((def) => `${def.name.padEnd(12)} ${def.description}`)
        .sort();
      return ok(lines.join("\n"));
    },
  });

  registry.add({
    name: "cmdabl",
    summary: "configure cmdAbl",
    description: "Setup and status commands of cmdAbl itself.",
    children: [
      {
        name: "setup",
        summary: "install trigger and Remote Script, then say what to do next",
        description:
          "Installs the keyboard trigger (Karabiner on macOS, AutoHotkey on Windows) and copies the Remote Script " +
          "into Live's User Library, then compares the shipped, installed and running script versions and says " +
          "what to do: restart Live, enable the control surface, or nothing.",
        examples: [{ line: "cmdabl setup", note: "run once after installing, and again after updating cmdAbl" }],
        run: async () => {
          const installedText = (deps.setup ?? runSetup)();
          let running: BridgeResult<HelloInfo> | null = null;
          if (deps.bridge) {
            try {
              running = await deps.bridge().ping(); // fresh: what Live has loaded right now
            } catch {
              running = null; // the bridge promises not to throw; setup never fails over this
            }
          }
          const advice = adviseRemoteScript({
            shipped: deps.shippedVersion ?? SCRIPT_VERSION,
            installed: (deps.installed ?? (() => inspectInstalledScript()))(),
            running,
          });
          return ok(`${installedText}\n\n${advice}`);
        },
      },
      {
        name: "bridge",
        summary: "show the Remote Script status (version, response time)",
        description: "Sends one fresh request to the Remote Script and reports its version, protocol, response time and operations.",
        examples: [{ line: "cmdabl bridge", note: "check that the Remote Script is installed and running" }],
        run: async () => {
          if (!deps.bridge) return fail(ExitCode.UNAVAILABLE, "the Remote Script bridge is not available in this build");
          // One fresh ping, answered at once: a dialog cannot show progress, and the
          // 20-round-trip measurement (GET /bridge) takes seconds.
          return (await reportBridge(deps.bridge(), undefined, { roundTrips: 1 })).result;
        },
      },
    ],
  });
}
