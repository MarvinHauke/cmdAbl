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

/** What sets Live's song length (user, 2026-11-12; plan 0027): the largest of these three. */
const LIMITS = "the last clip or automation + 8 bars, the loop's end, or the playhead + 8 bars";

/**
 * The sentence for a target time beyond Live's song length, or null when it is not (or the length is unknown):
 * "244.3.4 is too far: Live lets the playhead go only up to 58.3.3 here (…)". Live would refuse such a jump with a
 * raw RuntimeError. `loopStart` words it for a loop start: "loop start 244.3.4 is too far: Live allows positions
 * only up to 58.3.3 here (…)".
 */
export function behindSongEnd(time: number, songLength: number, sig: Signature, kind: "playhead" | "loopStart" = "playhead"): string | null {
  if (!(songLength > 0) || time <= songLength) return null;
  const at = beatsToPosition(time, sig);
  const end = beatsToPosition(songLength, sig);
  if (at === null || end === null) return `that is too far for Live (${LIMITS})`;
  if (kind === "loopStart") return `loop start ${fmt(at)} is too far: Live allows positions only up to ${fmt(end)} here (${LIMITS})`;
  return `${fmt(at)} is too far: Live lets the playhead go only up to ${fmt(end)} here (${LIMITS})`;
}

/**
 * Live's own refusal text → a sentence, when it is one of the two known "behind the Songlength" refusals
 * (loop and jump); anything else comes back unchanged. The raw text belongs in the log only. `sentence` is the
 * exact one (from `behindSongEnd`) when the caller knows the position.
 */
export function friendlyRefusal(text: string, sentence?: string | null): string {
  return /behind the song\s?length/i.test(text) ? (sentence ?? `that is too far for Live (${LIMITS})`) : text;
}
