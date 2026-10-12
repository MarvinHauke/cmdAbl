import { ExitCode, type CommandResult } from "./types.js";

/**
 * The one place a CommandResult becomes user-visible feedback.
 *
 * | result                | shown                                   |
 * |-----------------------|-----------------------------------------|
 * | code 0, no message    | nothing (silence is success)            |
 * | code 0, with message  | the message                             |
 * | code != 0             | the message, prefixed so it reads as an error |
 *
 * Per-target `details` are rendered here and only here — modules return a
 * short message plus `details`:
 *
 *   cmdAbl: arm: 1 of 2 done
 *     ✓ /Sub37 Audio
 *     × /Sub 37 Midi
 *         Live did not arm it: its arm button is disabled
 *         (e.g. the input device is not available)
 *
 * Successes first, then failures, each group in the given order. A failure's
 * reason sits on its own lines under the path; an opening parenthesis (" (")
 * starts a new line, which is the only break rule — the page wraps the rest.
 * A successful result lists nothing when every target succeeded.
 */
export function presentResult(result: CommandResult, show: (text: string) => void): void {
  if (result.code === ExitCode.OK && !result.message) return;

  const lines: string[] = [];
  if (result.message) lines.push(result.code === ExitCode.OK ? result.message : `cmdAbl: ${result.message}`);
  else lines.push(`cmdAbl: command failed (code ${result.code})`);

  const details = result.details ?? [];
  const failed = details.filter((d) => !d.ok);
  if (failed.length > 0 || result.code !== ExitCode.OK) {
    for (const d of details.filter((d) => d.ok)) lines.push(`  ✓ ${d.path}`);
    for (const d of failed) {
      lines.push(`  × ${d.path}`);
      for (const reason of reasonLines(d.message)) lines.push(`      ${reason}`);
    }
  }
  show(lines.join("\n"));
}

/**
 * A reason as lines: a break before each opening parenthesis, nothing else
 * (so a quoted name containing " (" would break too; reasons rarely quote paths).
 */
function reasonLines(message: string | undefined): string[] {
  const text = (message ?? "").trim();
  if (!text) return [];
  const lines: string[] = [];
  let start = 0;
  for (let at = text.indexOf(" (", 1); at > 0; at = text.indexOf(" (", at + 1)) {
    lines.push(text.slice(start, at));
    start = at + 1;
  }
  lines.push(text.slice(start));
  return lines;
}
