import { formatControl, isOperator, parseControl } from "../../core/midi.js";
import type { MidiBinding } from "../../core/midiEngine.js";

// The bindings of one Set as a JSON file (`modules/map/<setid>.json`, plan 0018). Pure.

interface Row {
  control: string;
  operator: string;
  line: string;
  threshold?: number;
}

/** The file text for the bindings, in order. */
export function serializeBindings(list: readonly MidiBinding[]): string {
  const rows: Row[] = list.map((b) => ({
    control: formatControl(b.control),
    operator: b.operator,
    line: b.line,
    ...(b.threshold !== undefined ? { threshold: b.threshold } : {}),
  }));
  return JSON.stringify({ version: 1, bindings: rows }, null, 2) + "\n";
}

/** The bindings in a file text; rows that do not make sense are dropped. `null` (no file) gives none; bad JSON or a file without a `bindings` list is `damaged` (the caller must not overwrite it). */
export function parseBindings(text: string | null): { bindings: MidiBinding[]; dropped: number; damaged: boolean } {
  if (text === null) return { bindings: [], dropped: 0, damaged: false };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { bindings: [], dropped: 0, damaged: true };
  }
  const rows = (data as { bindings?: unknown })?.bindings;
  if (!Array.isArray(rows)) return { bindings: [], dropped: 0, damaged: true };
  const bindings: MidiBinding[] = [];
  let dropped = 0;
  for (const row of rows as Array<Partial<Row> | null>) {
    const control = typeof row?.control === "string" ? parseControl(row.control) : null;
    if (!row || !control || typeof row.operator !== "string" || !isOperator(row.operator) || typeof row.line !== "string" || row.line.trim() === "") {
      dropped++;
      continue;
    }
    bindings.push({ control, operator: row.operator, line: row.line, ...(typeof row.threshold === "number" ? { threshold: row.threshold } : {}) });
  }
  return { bindings, dropped, damaged: false };
}

/** The same binding slot: one control with one operator (a second `map` for it replaces the line). */
export const sameSlot = (a: MidiBinding, b: MidiBinding): boolean => formatControl(a.control) === formatControl(b.control) && a.operator === b.operator;

/** One numbered row for `map -l`. */
export function bindingRow(n: number, b: MidiBinding, blocked = false, defaults: Readonly<Record<string, string>> = {}): string {
  // A line that is one bare command word with a default runs that default (0019 §7): show what it expands to.
  const word = b.line.trim();
  const ran = /^[^\s\\"']+$/.test(word) && Object.prototype.hasOwnProperty.call(defaults, word) ? ` → ${defaults[word]}` : "";
  return `${n}  ${formatControl(b.control)}  ${b.operator}  | ${b.line}${ran}${blocked ? "   ⚠ taken in Live" : ""}`;
}
