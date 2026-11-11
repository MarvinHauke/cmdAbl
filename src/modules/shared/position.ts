/**
 * Song positions (plan 0027): Live's `bar.beat.sixteenth` and the beats they mean in the Set's current time signature.
 * Pure; shared by `jump` and `note stamp next|prev|list` (the note module does not call the jump module).
 */

/** A position as written: bar and beat count from 1, a sixteenth is a quarter of a quarter note. */
export interface BarPosition {
  bar: number;
  beat: number;
  six: number;
}

/** The time signature; `den` 0 = unknown (an older Remote Script did not say). */
export interface Signature {
  num: number;
  den: number;
}

/** Length of a bar in beats (quarter notes): 4/4 → 4, 6/8 → 3, 7/8 → 3.5. Null when the signature is unknown. */
export function barLength(sig: Signature): number | null {
  return sig.num > 0 && sig.den > 0 ? (sig.num * 4) / sig.den : null;
}

/** Sixteenths in one beat of the signature (4/4 → 4, x/8 → 2). */
export function sixteenthsPerBeat(sig: Signature): number {
  return sig.den > 0 ? 16 / sig.den : 4;
}

/** Beats (quarter notes) from the start of the Set to the position; null when the signature is unknown. */
export function positionToBeats(p: BarPosition, sig: Signature): number | null {
  const len = barLength(sig);
  if (len === null) return null;
  return (p.bar - 1) * len + (p.beat - 1) * (4 / sig.den) + (p.six - 1) * 0.25;
}

/** "12.3.1" or "12.3.1.1" (the tick is dropped) → position; null when it is not one. */
export function parsePos(text: string): BarPosition | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(text.trim());
  if (!m) return null;
  return { bar: Number(m[1]), beat: Number(m[2]), six: Number(m[3]) };
}

/** Order of two positions: negative when a is before b. */
export function comparePos(a: BarPosition, b: BarPosition): number {
  return a.bar - b.bar || a.beat - b.beat || a.six - b.six;
}
