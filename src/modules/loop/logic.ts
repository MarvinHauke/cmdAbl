/**
 * Pure helpers of the `loop` module (plan 0026): the loop to set, "still ours", and the text of `loop`.
 * Times are in beats.
 */

/** A loop as the Remote Script reports it. */
export interface LoopState {
  on: boolean;
  start: number;
  length: number;
}

/** The part of the transport `loop` reads (structurally what `api.set.transport()` answers). */
export interface LoopTransport {
  barStart: number;
  barLen: number;
  loop: LoopState;
}

export const MIN_BARS = 1;
export const MAX_BARS = 64;

/** The loop `loop here` sets: from the current bar, `bars` long, on; null without a usable bar length or bar count. */
export function loopHere(transport: LoopTransport, bars: number): LoopState | null {
  if (!(transport.barLen > 0) || !Number.isInteger(bars) || bars < MIN_BARS || bars > MAX_BARS) return null;
  return { on: true, start: transport.barStart, length: bars * transport.barLen };
}

/** Parse the `bars` argument: an integer 1–64, or null. */
export function parseBars(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= MIN_BARS && n <= MAX_BARS ? n : null;
}

const EPSILON = 1e-3;

/** True when two loops are the same (small tolerance for what Live rounds). */
export function sameLoop(a: LoopState, b: LoopState): boolean {
  return a.on === b.on && Math.abs(a.start - b.start) < EPSILON && Math.abs(a.length - b.length) < EPSILON;
}

/** Put the old loop back only if nobody moved the one `loop here` set. */
export function shouldRestoreLoop(current: LoopState | null, set: LoopState): boolean {
  return current !== null && sameLoop(current, set);
}

/** Beats to a bar number from the bar length: start bar is 1-based, as in Live. Returns a short text like "bar 12, 4 bars". */
export function describeLoop(transport: LoopTransport): string {
  const { loop, barLen } = transport;
  const state = loop.on ? "on" : "off";
  if (!(barLen > 0)) return `loop ${state}`;
  const startBar = Math.round((loop.start / barLen) * 1000) / 1000 + 1;
  const bars = Math.round((loop.length / barLen) * 1000) / 1000;
  return `loop ${state}: from bar ${startBar}, ${bars} bar${bars === 1 ? "" : "s"}`;
}
