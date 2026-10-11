import { ExitCode, type CommandResult } from "../types.js";

/**
 * The one place a CommandResult becomes user-visible feedback.
 *
 * | result                | shown                                   |
 * |-----------------------|-----------------------------------------|
 * | code 0, no message    | nothing (silence is success)            |
 * | code 0, with message  | the message                             |
 * | code != 0             | the message, prefixed so it reads as an error |
 *
 * Per-target `details` are folded into the text as a short list. The output
 * channel (modal vs. a lighter status line) is plan 0002 Phase B — until then
 * everything goes through the single `show` function the platform supplies.
 */
export function presentResult(result: CommandResult, show: (text: string) => void): void {
  if (result.code === ExitCode.OK && !result.message) return;

  const lines: string[] = [];
  if (result.message) lines.push(result.code === ExitCode.OK ? result.message : `cmdAbl: ${result.message}`);
  else lines.push(`cmdAbl: command failed (code ${result.code})`);

  for (const d of result.details ?? []) {
    if (d.ok && result.code === ExitCode.OK) continue; // success lines only matter when something failed
    lines.push(`  ${d.ok ? "✓" : "✗"} ${d.path}${d.message ? ` — ${d.message}` : ""}`);
  }
  show(lines.join("\n"));
}
