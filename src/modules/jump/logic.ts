import { barLength, sixteenthsPerBeat, positionToBeats, type Signature } from "../shared/position.js";

/** What `jump` was asked for. `bar.beat` and `bar.beat.six` default the missing parts to 1. */
export type JumpTarget =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "relative"; n: number; unit: StepUnit }
  | { kind: "position"; bar: number; beat: number; six: number; parts: 1 | 2 | 3 };

/** `+N` counts steps (the `jump.step` size), `+Nb` bars, `+Nq` quarters. */
export type StepUnit = "step" | "bar" | "quarter";

/** The values of the `jump.step` setting, with their length in beats; `live` = Live's global launch quantization. */
export const STEP_CHOICES: { value: string; label: string; beats: number | null }[] = [
  { value: "live", label: "Live's launch quantization", beats: null },
  { value: "8bars", label: "8 bars", beats: 32 },
  { value: "4bars", label: "4 bars", beats: 16 },
  { value: "2bars", label: "2 bars", beats: 8 },
  { value: "bar", label: "1 bar", beats: 4 },
  { value: "half", label: "1/2", beats: 2 },
  { value: "quarter", label: "1/4", beats: 1 },
  { value: "eighth", label: "1/8", beats: 0.5 },
  { value: "sixteenth", label: "1/16", beats: 0.25 },
];

/**
 * Length of one step in beats. Fixed settings: a bar or longer is counted in bars of the current signature
 * (`barLen` times the number of bars), shorter ones in 4/4 note values; `live` takes Live's launch quantization
 * in beats (`launch`), and 1 bar when it is unknown or "None" (null / <= 0).
 */
export function stepBeats(setting: string, launch: number | null | undefined, barLen: number): number {
  const choice = STEP_CHOICES.find((c) => c.value === setting);
  if (choice === undefined || choice.beats === null) return launch !== null && launch !== undefined && launch > 0 ? launch : barLen;
  return choice.beats >= 4 ? (choice.beats / 4) * barLen : choice.beats;
}

/** Parse the argument of `jump`; null when it is none of the forms. */
export function parseTarget(text: string): JumpTarget | null {
  const t = text.trim().toLowerCase();
  if (t === "start") return { kind: "start" };
  if (t === "end") return { kind: "end" };
  const rel = /^([+-])(\d+)([bq]?)$/.exec(t);
  if (rel) return { kind: "relative", n: (rel[1] === "-" ? -1 : 1) * Number(rel[2]), unit: rel[3] === "b" ? "bar" : rel[3] === "q" ? "quarter" : "step" };
  const m = /^(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/.exec(t);
  if (!m) return null;
  const parts = m[3] !== undefined ? 3 : m[2] !== undefined ? 2 : 1;
  return { kind: "position", bar: Number(m[1]), beat: m[2] !== undefined ? Number(m[2]) : 1, six: m[3] !== undefined ? Number(m[3]) : 1, parts };
}

/** The part of the transport the math needs. */
export interface JumpTransport extends Signature {
  barStart: number;
  barLen: number;
  songLength: number;
  /** The playhead in beats; only needed for steps shorter than a bar. */
  time?: number;
  /** One `jump.step` step in beats; default: a bar. */
  step?: number;
}

export type Resolved = { ok: true; time: number; text: string } | { ok: false; code: 2 | 5; text: string };

/** Where the playhead goes, in beats. Exit 2 for a position that does not exist, 5 when bar.beat needs a signature the script did not report. */
export function resolveTarget(target: JumpTarget, t: JumpTransport): Resolved {
  switch (target.kind) {
    case "start":
      return { ok: true, time: 0, text: "the start" };
    case "end":
      return t.songLength > 0 ? { ok: true, time: t.songLength, text: "the end" } : { ok: false, code: 5, text: "the Set length is unknown or 0" };
    case "relative": {
      const sign = target.n > 0 ? "+" : "";
      // From the start of the current step (bars: the current bar; a bar's quarters: the current beat).
      let size: number;
      let what: string;
      if (target.unit === "bar") [size, what] = [t.barLen, target.n === 1 || target.n === -1 ? "bar" : "bars"];
      else if (target.unit === "quarter") [size, what] = [1, target.n === 1 || target.n === -1 ? "quarter" : "quarters"];
      else [size, what] = [t.step ?? t.barLen, target.n === 1 || target.n === -1 ? "step" : "steps"];
      const base = size === t.barLen ? t.barStart : Math.floor(((t.time ?? t.barStart) + 1e-9) / size) * size;
      const raw = base + target.n * size;
      if (raw < 0) return { ok: true, time: 0, text: "the start (clamped)" };
      return { ok: true, time: raw, text: `${sign}${target.n} ${what}` };
    }
    case "position": {
      const len = barLength(t);
      if (len === null) return { ok: false, code: 5, text: "bar positions need the time signature: update the Remote Script" };
      if (target.bar < 1) return { ok: false, code: 2, text: `bar ${target.bar} does not exist (bars start at 1)` };
      if (target.beat < 1 || target.beat > t.num) return { ok: false, code: 2, text: `beat ${target.beat} does not exist in ${t.num}/${t.den} (1–${t.num})` };
      const maxSix = sixteenthsPerBeat(t);
      if (maxSix < 1) return { ok: false, code: 5, text: `sixteenths are not supported in ${t.num}/${t.den}` };
      if (target.six < 1 || target.six > maxSix) return { ok: false, code: 2, text: `sixteenth ${target.six} does not exist in ${t.num}/${t.den} (1–${maxSix})` };
      const time = positionToBeats(target, t);
      if (time === null) return { ok: false, code: 5, text: "bar positions need the time signature: update the Remote Script" };
      return { ok: true, time, text: `${target.bar}.${target.beat}.${target.six}` };
    }
  }
}
