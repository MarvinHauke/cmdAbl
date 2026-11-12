import { ok, fail, ExitCode, type CommandResult } from "../types.js";
import type { Command } from "../command/commandRegistry.js";
import { runAhkSetup, runKarabinerSetup, runRemoteScriptSetup } from "./setup.js";
import { restartLive } from "./restart.js";
import { SIMULATE_STATES, isSimulateState } from "./simulate.js";
import type { SetupFlow } from "./setupFlow.js";

// `cmdabl setup` (plan 0021): the setup page, and its steps `script` and `karabiner`.

export interface SetupCommandDeps {
  /** `cmdabl setup` (plan 0021): the page and its flow; absent: it answers exit 5. */
  setup?: Pick<SetupFlow, "show">;
  /** Development builds only (CMDABL_DEV_ROUTES): register the hidden option `--simulate <state>`. Absent in production builds, so the reference and released help never list it. */
  simulate?: boolean;
  /** True during a headless run (agent, MIDI binding): `setup restart` refuses then, because only the user restarts Live. */
  headless?: () => boolean;
  /** Test hooks: the steps `cmdabl setup script` and `cmdabl setup karabiner` run. */
  steps?: {
    copyScript?: () => { ok: boolean; text: string };
    keyboard?: () => { ok: boolean; text: string };
    restart?: () => Promise<CommandResult>;
  };
}

/** A setup step's outcome as a result: failure carries the step's own text, success `done` (or the step's text). */
function stepResult(done: string | undefined, step: { ok: boolean; text: string }): CommandResult {
  return step.ok ? ok(done === undefined || step.text.includes("nothing to copy") ? step.text : done) : fail(ExitCode.FAILURE, step.text);
}

export function setupCommand(deps: SetupCommandDeps): Command {
  return {
    name: "setup",
    outside: true, // edits the installation (Remote Script, trigger): no module or page may run it (plan 0028)
    summary: "show what is set up and what still needs you",
    description:
      "Opens the setup page: one row per step (keyboard trigger, Remote Script, restarting Live, the control surface, the data folder) " +
      "with ✓ / ! / ✗ and a button where a step needs you. It opens by itself on the first start and after an update that needs a step " +
      "(switch off with \"Don't open this page by itself\" or `cmdabl config setup`). `cmdabl setup script` copies or updates the Remote Script, " +
      "`cmdabl setup restart` quits Live (it asks about unsaved changes) and starts it again (macOS). `cmdabl setup karabiner` links the Karabiner rule (macOS) or installs the AutoHotkey script (Windows) the old way. " +
      "Without a screen (an agent's run) the rows come back as text lines.",
    examples: [
      { line: "cmdabl setup", note: "show the setup page" },
      { line: "cmdabl setup script", note: "copy or update the Remote Script, then restart Live once" },
      { line: "cmdabl setup restart", note: "quit Live and start it again" },
      { line: "cmdabl setup karabiner", note: "link the Karabiner rule without the import link" },
    ],
    args: [{ name: "step", kind: "enum", required: false, choices: ["script", "karabiner", "restart"], summary: "script: copy or update the Remote Script; restart: quit Live and start it again (macOS); karabiner: link the Karabiner rule (AutoHotkey script on Windows)" }],
    // Hidden: only registered in development builds; production builds, the reference and released help never list it.
    ...(deps.simulate
      ? { options: [{ name: "simulate", takesValue: true, choices: [...SIMULATE_STATES], summary: "development: show the page as if the machine were in this state" }] }
      : {}),
    run: async (invocation) => {
      const simulate = invocation.options.simulate;
      if (simulate !== undefined) {
        if (!deps.simulate || !isSimulateState(simulate)) return fail(ExitCode.USAGE, `setup: unknown state "${String(simulate)}"`);
        return deps.setup ? deps.setup.show(simulate) : fail(ExitCode.UNAVAILABLE, "setup: the setup page is not available in this build");
      }
      const step = invocation.args[0]?.[0];
      if (step === "script") return stepResult("Remote Script copied. Restart Live once to load it.", (deps.steps?.copyScript ?? runRemoteScriptSetup)());
      if (step === "restart") {
        if (deps.headless?.()) return fail(ExitCode.UNAVAILABLE, "restart: restarting Live needs the setup page or the palette");
        return (deps.steps?.restart ?? restartLive)();
      }
      if (step === "karabiner") return stepResult(undefined, (deps.steps?.keyboard ?? (process.platform === "win32" ? runAhkSetup : runKarabinerSetup))());
      return deps.setup ? deps.setup.show() : fail(ExitCode.UNAVAILABLE, "setup: the setup page is not available in this build");
    },
  };
}
