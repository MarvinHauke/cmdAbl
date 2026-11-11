import { barLength, sixteenthsPerBeat, positionToBeats, type Signature } from "../shared/position.js";

/** What `jump` was asked for. `bar.beat` and `bar.beat.six` default the missing parts to 1. */
export type JumpTarget =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "relative"; bars: number }
  | { kind: "position"; bar: number; beat: number; six: number; parts: 1 | 2 | 3 };

/** Parse the argument of `jump`; null when it is none of the forms. */
export function parseTarget(text: string): JumpTarget | null {
  const t = text.trim().toLowerCase();
  if (t === "start") return { kind: "start" };
  if (t === "end") return { kind: "end" };
  const rel = /^([+-])(\d+)$/.exec(t);
  if (rel) return { kind: "relative", bars: (rel[1] === "-" ? -1 : 1) * Number(rel[2]) };
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
      const raw = t.barStart + target.bars * t.barLen;
      if (raw < 0) return { ok: true, time: 0, text: "the start (clamped)" };
      return { ok: true, time: raw, text: `${target.bars > 0 ? "+" : ""}${target.bars} bars` };
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
