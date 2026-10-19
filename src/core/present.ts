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
 *     ✓ /Bass
 *     × /Lead
 *         Live did not arm it: its arm button is disabled
 *         (e.g. the input device is not available)
 *
 * Successes first, then failures, each group in the given order. Failures with
 * the same reason are listed one after another and the reason follows once
 * (groups ordered by their first failure). A failure's
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
    // Failures sharing a reason are listed together and the reason is printed
    // once below them; groups keep the order of their first failure.
    const groups = new Map<string, string[]>();
    failed.forEach((d, i) => {
      const reason = (d.message ?? "").trim();
      const key = reason || `\0${i}`; // no reason: never grouped
      groups.set(key, [...(groups.get(key) ?? []), d.path]);
    });
    for (const [key, paths] of groups) {
      for (const path of paths) lines.push(`  × ${path}`);
      for (const reason of reasonLines(key.startsWith("\0") ? undefined : key)) lines.push(`      ${reason}`);
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
