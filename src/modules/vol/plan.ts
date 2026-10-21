import { dbToValue, valueToDb, type FaderLimit } from "../mixValue.js";

/**
 * A level or step in dB as the user types it: a number (`-6`, `+2`, `-0.5`, `.5`) or `-inf`. Null for anything
 * else, `inf` / `+inf` included (a fader cannot go to infinity; +6 dB is the top).
 */
export function parseDb(text: string): number | null {
  const word = text.trim().toLowerCase();
  if (word === "-inf") return -Infinity;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return null;
  return Number(word);
}

/** A level for the result and the undo line: one decimal (Live shows 0.1 dB), `-inf` for silence. */
export function formatDb(db: number): string {
  if (db === -Infinity) return "-inf";
  if (db === Infinity) return "+inf";
  const text = (Math.round(db * 10) / 10).toFixed(1);
  return text === "-0.0" ? "0.0" : text;
}

/** A level with its sign, for the question: `+3.0`, `-6.0`, `0.0`. */
export const formatSigned = (db: number): string => {
  const text = formatDb(db);
  return /^\d/.test(text) && text !== "0.0" ? `+${text}` : text;
};

export interface FaderPlan {
  oldValue: number;
  oldDb: number;
  newValue: number;
  newDb: number;
  /** The requested level was past the fader's end. */
  limit?: FaderLimit;
  /** The level the step asked for before the fader's ends cut it (relative: old + step; absolute: the level). */
  askedDb: number;
  /** The fader does not move. */
  same: boolean;
}

/**
 * What one fader does for `vol`: `absolute` sets it to `db`, otherwise `db` is added to where it is now.
 * A fader at -inf has nothing to add to: a relative step leaves it there and reports the -inf limit
 * (`vol --set` gets it out). A step of 0 changes nothing and reports nothing.
 */
export function planFader(oldValue: number, db: number, absolute: boolean): FaderPlan {
  const oldDb = valueToDb(oldValue);
  if (!absolute && db === 0) return { oldValue, oldDb, newValue: oldValue, newDb: oldDb, askedDb: oldDb, same: true };
  const askedDb = absolute ? db : oldDb + db;
  const { value, limit } = dbToValue(askedDb);
  return {
    askedDb,
    oldValue,
    oldDb,
    newValue: value,
    newDb: valueToDb(value),
    ...(limit ? { limit } : {}),
    same: Math.abs(value - oldValue) < 1e-9 || formatDb(valueToDb(value)) === formatDb(oldDb),
  };
}
