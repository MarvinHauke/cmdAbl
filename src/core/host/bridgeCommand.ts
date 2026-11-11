import { fail, ExitCode } from "../types.js";
import type { Command } from "../command/commandRegistry.js";
import { reportBridge, type BridgeProbe } from "./bridgeStatus.js";

// `cmdabl bridge`: the Remote Script's status.

export interface BridgeCommandDeps {
  /** The Remote Script bridge, for `cmdabl bridge`. */
  bridge?: () => BridgeProbe;
}

export function bridgeCommand(deps: BridgeCommandDeps): Command {
  return {
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
  };
}
