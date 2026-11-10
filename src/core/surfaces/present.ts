import { isHttpsUrl } from "../setup/openUrl.js";
import { ExitCode, type CommandResult, type ItemAction, type ResultLink, type ResultSection, type StatusItem } from "../types.js";

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
export function presentResult(result: CommandResult, show: (text: string, link?: ResultLink, sections?: ResultSection[]) => void): void {
  if (result.code === ExitCode.OK && !result.message) return;
  const link = result.link && result.link.label.trim() && isHttpsUrl(result.link.url) ? result.link : undefined;

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
  // Sections replace the text on the page, and the text holds the failures: show them only for a clean result.
  const clean = result.code === ExitCode.OK && !failed.length;
  const sections = clean ? capSections(result.sections) : [];
  show(lines.join("\n"), link, sections.length ? sections : undefined);
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

export const MAX_SECTIONS = 40;
export const MAX_ITEMS = 200;
export const MAX_TEXT = 300;

const clip = (text: unknown): string => {
  const value = typeof text === "string" ? text : "";
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;
};

const STATUSES = ["ok", "warn", "fail"];
const MAX_ACTION = 1000;

/** A status row as the page gets it: text and label clipped, a bad status or an unusable action dropped. Null: not a row. */
function capItem(item: unknown): string | StatusItem | null {
  if (typeof item === "string") return clip(item);
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  if (typeof r.text !== "string") return null;
  const out: StatusItem = { text: clip(r.text) };
  if (typeof r.status === "string" && STATUSES.includes(r.status)) out.status = r.status as StatusItem["status"];
  const a = r.action as Record<string, unknown> | null | undefined;
  if (typeof a === "object" && a !== null && typeof a.label === "string" && a.label.trim() !== "") {
    const target = typeof a.command === "string" ? { command: a.command } : typeof a.url === "string" ? { url: a.url } : null;
    const value = target ? Object.values(target)[0]! : "";
    if (target && value !== "" && value.length <= MAX_ACTION) {
      const help = typeof a.help === "string" && a.help.trim() !== "" ? { help: clip(a.help) } : {};
      out.action = { label: clip(a.label).trim(), ...help, ...target } as ItemAction;
    }
  }
  return out;
}

/**
 * Sections as the page gets them: strings and status rows only, empty headings dropped, at most
 * MAX_SECTIONS sections of MAX_ITEMS items of MAX_TEXT characters; a cut list ends with "…".
 */
export function capSections(sections: ResultSection[] | undefined): ResultSection[] {
  if (!Array.isArray(sections)) return [];
  const out: ResultSection[] = [];
  for (const section of sections.slice(0, MAX_SECTIONS)) {
    const heading = clip(section?.heading).trim();
    if (!heading) continue;
    const items = (Array.isArray(section.items) ? section.items : []).map(capItem).filter((i): i is string | StatusItem => i !== null);
    const shown = items.slice(0, MAX_ITEMS);
    if (items.length > MAX_ITEMS) shown.push("…");
    const meta = clip(section.meta).trim();
    out.push({ heading, ...(meta ? { meta } : {}), items: shown });
  }
  return out;
}
