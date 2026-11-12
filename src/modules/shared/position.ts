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

/** Beats → "bar.beat.sixteenth" in the signature (the inverse of positionToBeats); null when the signature is unknown. */
export function beatsToPosition(beats: number, sig: Signature): BarPosition | null {
  const len = barLength(sig);
  if (len === null) return null;
  const bar = Math.floor(beats / len);
  const beatLen = 4 / sig.den;
  const rem = beats - bar * len;
  const beat = Math.floor(rem / beatLen);
  const six = Math.floor((rem - beat * beatLen) / 0.25);
  return { bar: bar + 1, beat: beat + 1, six: six + 1 };
}

const fmt = (p: BarPosition): string => `${p.bar}.${p.beat}.${p.six}`;

/**
 * The sentence for a target time behind the end of the song, or null when it is not (or the length is unknown):
 * "244.3.4 is behind the end of the song (it ends at 58.3.3)". Live would refuse such a jump with a raw RuntimeError.
 */
export function behindSongEnd(time: number, songLength: number, sig: Signature): string | null {
  if (!(songLength > 0) || time <= songLength) return null;
  const at = beatsToPosition(time, sig);
  const end = beatsToPosition(songLength, sig);
  if (at === null || end === null) return "that is behind the end of the song";
  return `${fmt(at)} is behind the end of the song (it ends at ${fmt(end)})`;
}

/**
 * Live's own refusal text → a sentence, when it is one of the two known "behind the Songlength" refusals
 * (loop and jump); anything else comes back unchanged. The raw text belongs in the log only.
 */
export function friendlyRefusal(text: string): string {
  return /behind the song\s?length/i.test(text) ? "that is behind the end of the song" : text;
}
