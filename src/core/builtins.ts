import type { CommandRegistry } from "./commandRegistry.js";
import { SCRIPT_VERSION, type BridgeResult, type HelloInfo } from "../ableton/bridgeProtocol.js";
import { inspectInstalledScript, type InstalledScript } from "../ableton/installedScript.js";
import { REMOTE_SCRIPT_DOCS_URL, runSetup } from "./setup.js";
import { ok, fail, ExitCode } from "./types.js";
import { reportBridge, type BridgeProbe } from "./bridgeStatus.js";
import { adviseRemoteScript } from "./setupAdvice.js";
import { appLog, type Log } from "./log.js";

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
  /** The log `cmdabl log` shows (default: the extension's). */
  log?: Pick<Log, "lines" | "setDebug" | "debugOn">;
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
          return ok(`${installedText}\n\n${advice}\n${REMOTE_SCRIPT_DOCS_URL}`);
        },
      },
      {
        name: "log",
        summary: "show the last lines of cmdAbl's log",
        description:
          "Shows the last 50 lines of the log, newest at the bottom: what commands ran, what changed and the undo lines " +
          "of tag writes (Cmd+Z does not undo tags). The log keeps the last 500 lines of this session. " +
          "--debug turns detail lines on for the rest of the session.",
        examples: [
          { line: "cmdabl log", note: "the last 50 lines" },
          { line: "cmdabl log -n 200", note: "more lines" },
          { line: "cmdabl log --undo", note: "only the lines that say how to undo a change" },
          { line: "cmdabl log --debug", note: "turn on debug lines for this session" },
        ],
        options: [
          { name: "count", short: "n", takesValue: true, number: { min: 1, max: 500, integer: true }, summary: "show this many lines (default 50)" },
          { name: "undo", takesValue: false, summary: "only the lines that contain \"undo: \"" },
          { name: "debug", takesValue: false, summary: "turn debug lines on for this session" },
        ],
        run: (invocation) => {
          const log = deps.log ?? appLog;
          const turnedOn = invocation.options.debug === true && !log.debugOn();
          if (invocation.options.debug === true) log.setDebug(true);
          const count = invocation.options.count ? Number(invocation.options.count) : 50;
          const all = log.lines();
          const wanted = invocation.options.undo === true ? all.filter((l) => l.includes("undo: ")) : all;
          const shown = wanted.slice(-count);
          const note = turnedOn ? "debug lines are on for this session\n" : "";
          if (shown.length === 0) return ok(`${note}${invocation.options.undo === true ? "no undo lines in the log" : "the log is empty"}`);
          return ok(`${note}${shown.join("\n")}`);
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
