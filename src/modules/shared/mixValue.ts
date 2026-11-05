import { DB_AT_STEP } from "./mixTable.js";

// Fader value (0..1, the SDK's mixer.volume) <-> dB, from Live's own curve measured in Live
// (mixTable.ts, plan 0012). Linear between the 1001 points; the inverse is a binary search.

const STEPS = DB_AT_STEP.length - 1; // 1000
/** The highest level a fader reaches (value 1.0). */
export const MAX_DB = DB_AT_STEP[STEPS]!;
/** The value that is 0 dB. */
export const UNITY_VALUE = 0.85;
/** The lowest level above -inf the table knows (value 0.001); below it the fader goes to -inf. */
export const MIN_FINITE_DB = DB_AT_STEP[1]!;

/** The fader value (clamped to 0..1) as dB; `-Infinity` for 0. */
export function valueToDb(value: number): number {
  if (!(value > 0)) return -Infinity; // 0, below and NaN
  if (value >= 1) return MAX_DB;
  const x = value * STEPS;
  const i = Math.floor(x);
  const lo = DB_AT_STEP[i]!;
  const hi = DB_AT_STEP[i + 1]!;
  if (i === 0) return hi; // between -inf and the first step: the first finite level
  return lo + (hi - lo) * (x - i);
}

/** Why a requested level could not be reached exactly. */
export type FaderLimit = "max" | "-inf";

export interface DbValue {
  /** The fader value 0..1. */
  value: number;
  /** Set when the request was past the top (`max`) or at/below the bottom (`-inf`) of the fader. */
  limit?: FaderLimit;
}

/**
 * The fader value for a level in dB. Above the maximum (+6 dB) the value is 1.0 and `limit` is "max"; at
 * -inf, or below the lowest step of the curve (-69.6 dB), it is 0 and `limit` is "-inf". The curve is
 * quantised to 0.1 dB, so where several steps show the same level the middle of them is taken.
 */
export function dbToValue(db: number): DbValue {
  if (Number.isNaN(db)) return { value: 0, limit: "-inf" };
  if (db > MAX_DB) return { value: 1, limit: "max" };
  if (db === MAX_DB) return { value: 1 };
  if (db < MIN_FINITE_DB) return { value: 0, limit: "-inf" };
  // lo: first step with level >= db; hi: last step with level <= db.
  let a = 1;
  let b = STEPS;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (DB_AT_STEP[mid]! >= db) b = mid;
    else a = mid + 1;
  }
  const lo = a;
  a = 1;
  b = STEPS;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (DB_AT_STEP[mid]! <= db) a = mid;
    else b = mid - 1;
  }
  const hi = a;
  if (DB_AT_STEP[lo] === db) return { value: (lo + hi) / 2 / STEPS };
  // db lies between steps hi and lo = hi + 1.
  const from = DB_AT_STEP[hi]!;
  const to = DB_AT_STEP[lo]!;
  return { value: (hi + (db - from) / (to - from)) / STEPS };
}
