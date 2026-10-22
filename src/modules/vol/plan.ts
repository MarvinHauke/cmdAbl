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
  /** The fader does not move (to the level Live shows, 0.1 dB). */
  same: boolean;
}

/** A fader's move to the new level `newDb` (already within the fader's range, or -Infinity). */
export function faderMove(oldValue: number, newDb: number): FaderPlan {
  const oldDb = valueToDb(oldValue);
  const { value } = dbToValue(newDb);
  const newValue = value;
  return {
    oldValue,
    oldDb,
    newValue,
    newDb: valueToDb(newValue),
    same: Math.abs(newValue - oldValue) < 1e-9 || formatDb(valueToDb(newValue)) === formatDb(oldDb),
  };
}

/** `vol --set <db>`: the fader goes to `db`; `limit` says the level was past an end (above +6 dB, or -inf / below the lowest step). */
export function planAbsolute(oldValue: number, db: number): FaderPlan & { limit?: FaderLimit } {
  const { limit } = dbToValue(db);
  return { ...faderMove(oldValue, db), ...(limit ? { limit } : {}) };
}
