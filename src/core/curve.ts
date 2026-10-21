// `cmdabl curve` (plan 0012): measure Live's volume curve for developers. Sweeps the first regular
// track's volume through the script's `param_display` (Live's own display text, no fader moves),
// logs the table under the source `curve` and returns a short summary. Pure over injected ports.

import { ExitCode, fail, ok, type CommandResult } from "./types.js";
import { logger } from "./log.js";

/** Points per log line: the log holds 500 lines, the table must not push everything else out. */
export const CURVE_PER_LINE = 10;
export const CURVE_STEPS = 1000; // values 0, 1/1000 … 1 → 1001 points

export interface CurveDeps {
  /** True when there is a regular track to measure. */
  hasTrack: () => boolean;
  /** Live's display text for each value (0..1) of that track's volume; `ok: false` carries the exit code. */
  display: (values: number[]) => Promise<{ ok: true; value: string[] } | { ok: false; code: number; text: string }>;
  /** Where the table goes (default: the logger, source `curve`). */
  log?: (line: string) => void;
}

/** "-6.0 dB" → -6, "-inf dB" → -Infinity, anything else null. */
export function parseDb(text: string): number | null {
  const m = /^\s*(?:(-?inf(?:inity)?)|([+-]?\d+(?:\.\d+)?))\s*dB\s*$/i.exec(text);
  if (!m) return null;
  if (m[1]) return -Infinity;
  const value = Number(m[2]);
  return Number.isFinite(value) ? value : null;
}

export async function measureCurve(deps: CurveDeps): Promise<CommandResult> {
  if (!deps.hasTrack()) return fail(ExitCode.NOT_FOUND, "curve: the Set has no regular track to measure");
  const values = Array.from({ length: CURVE_STEPS + 1 }, (_, i) => i / CURVE_STEPS);
  let reply;
  try {
    reply = await deps.display(values);
  } catch (e: unknown) {
    return fail(ExitCode.UNAVAILABLE, `curve: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!reply.ok) return fail(reply.code as 1 | 2 | 3 | 4 | 5, reply.text);
  if (reply.value.length !== values.length) return fail(ExitCode.FAILURE, "curve: the Remote Script answered a different number of values");

  const log = deps.log ?? ((line: string) => logger("curve").info(line));
  const bad: string[] = [];
  let measured = 0;
  const best: { at: { value: number; db: number } | null } = { at: null };
  const last: { db: number | null } = { db: null };
  // The log keeps 500 lines: pack the table, CURVE_PER_LINE points to a line (about 101 lines).
  const cells: string[] = [];
  const flush = (): void => {
    if (cells.length) log(cells.join(" | "));
    cells.length = 0;
  };
  values.forEach((value, i) => {
    const text = reply.value[i]!;
    const db = parseDb(text);
    cells.push(`${value.toFixed(3)} ${db === null ? JSON.stringify(text) : db === -Infinity ? "-inf" : db.toFixed(1)}`);
    if (cells.length === CURVE_PER_LINE) flush();
    if (db === null) {
      bad.push(`${value.toFixed(3)}: ${text}`);
      return;
    }
    measured++;
    if (Number.isFinite(db) && (best.at === null || Math.abs(db) < Math.abs(best.at.db))) best.at = { value, db };
    if (i === values.length - 1) last.db = db;
  });
  flush();
  const z = best.at;
  const lines = [
    `${measured} of ${values.length} points measured (table in the log: cmdabl log -n 120, source curve)`,
    z ? `0 dB at value ${z.value.toFixed(3)}${z.db === 0 ? "" : ` (nearest: ${z.db.toFixed(1)} dB)`}` : "no finite dB value found",
    `value 1.0 = ${last.db === null ? "?" : last.db === -Infinity ? "-inf" : last.db.toFixed(1)} dB`,
    bad.length ? `could not parse ${bad.length}: ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? "; …" : ""}` : "every string parsed",
  ];
  return ok(lines.join("\n"));
}
