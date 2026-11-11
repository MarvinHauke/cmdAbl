import { fail, ExitCode } from "../types.js";
import type { Command } from "../command/commandRegistry.js";
import { measureCurve, type CurveDeps } from "./curve.js";

// `cmdabl curve`: measure Live's volume curve (a calibration tool for developers, plan 0012).

export interface CurveCommandDeps {
  /** The ports of `cmdabl curve` (absent: it answers exit 5). */
  curve?: CurveDeps;
}

export function curveCommand(deps: CurveCommandDeps): Command {
  return {
    name: "curve",
    summary: "measure Live's volume curve for developers",
    description:
      "Reads Live's own display text for 1001 volume values (0, 0.001 … 1) of the first regular track through the Remote Script, " +
      "without moving any fader. The table goes to the log, ten points to a line (source curve; see cmdabl log -n 120); the result shows the points measured, " +
      "the value at 0 dB and the dB at value 1.0. Writes nothing.",
    examples: [{ line: "cmdabl curve", note: "measure the curve once and read the table from the log" }],
    requires: ["bridge"],
    run: async () => (deps.curve ? measureCurve(deps.curve) : fail(ExitCode.UNAVAILABLE, "curve: the Remote Script bridge is not available in this build")),
  };
}
