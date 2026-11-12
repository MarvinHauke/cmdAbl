import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTarget, resolveTarget, stepBeats, type JumpTransport } from "./logic.js";

const t44: JumpTransport = { num: 4, den: 4, barStart: 44, barLen: 4, songLength: 64 };
const t68: JumpTransport = { num: 6, den: 8, barStart: 9, barLen: 3, songLength: 64 };
const t78: JumpTransport = { num: 7, den: 8, barStart: 0, barLen: 3.5, songLength: 64 };
const old: JumpTransport = { num: 0, den: 0, barStart: 44, barLen: 4, songLength: 0 };
const time = (s: string, tr: JumpTransport) => {
  const target = parseTarget(s);
  assert.ok(target, s);
  return resolveTarget(target, tr);
};

test("parseTarget knows the forms and rejects the rest", () => {
  assert.deepEqual(parseTarget("12.3.1"), { kind: "position", bar: 12, beat: 3, six: 1, parts: 3 });
  assert.deepEqual(parseTarget("12"), { kind: "position", bar: 12, beat: 1, six: 1, parts: 1 });
  assert.deepEqual(parseTarget("5.2"), { kind: "position", bar: 5, beat: 2, six: 1, parts: 2 });
  assert.deepEqual(parseTarget("+4"), { kind: "relative", n: 4, unit: "step" });
  assert.deepEqual(parseTarget("-4"), { kind: "relative", n: -4, unit: "step" });
  assert.deepEqual(parseTarget("START"), { kind: "start" });
  assert.deepEqual(parseTarget("end"), { kind: "end" });
  for (const bad of ["", "x", "1.2.3.4", "1..2", "+", "-x", "1.5e3", "12.", "--4"]) assert.equal(parseTarget(bad), null, bad);
});

test("4/4: bar.beat.sixteenth to beats", () => {
  assert.deepEqual(time("1", t44), { ok: true, time: 0, text: "1.1.1" });
  assert.equal((time("12.3.1", t44) as { time: number }).time, 44 + 2);
  assert.equal((time("2.1.2", t44) as { time: number }).time, 4.25);
});

test("6/8: a bar is 3 beats, a beat an eighth, two sixteenths", () => {
  assert.equal((time("3", t68) as { time: number }).time, 6);
  assert.equal((time("1.2.1", t68) as { time: number }).time, 0.5);
  assert.equal((time("1.2.2", t68) as { time: number }).time, 0.75);
  assert.equal(time("1.1.3", t68).ok, false);
  assert.equal(time("1.7.1", t68).ok, false);
});

test("7/8: a bar is 3.5 beats", () => {
  assert.equal((time("3", t78) as { time: number }).time, 7);
  assert.equal((time("2.7.1", t78) as { time: number }).time, 3.5 + 3);
});

test("bad positions are exit 2, an unknown signature is exit 5", () => {
  assert.deepEqual(time("0", t44), { ok: false, code: 2, text: "bar 0 does not exist (bars start at 1)" });
  assert.equal((time("1.5.1", t44) as { code: number }).code, 2);
  assert.equal((time("1.1.5", t44) as { code: number }).code, 2);
  assert.equal((time("1.0.1", t44) as { code: number }).code, 2);
  assert.equal((time("12.3.1", old) as { code: number }).code, 5);
  assert.equal((time("12", old) as { code: number }).code, 5);
});

test("relative moves by bars from the current bar; start and end", () => {
  assert.equal((time("+4", t44) as { time: number }).time, 60);
  assert.equal((time("-4", t44) as { time: number }).time, 28);
  assert.equal((time("-40", t44) as { time: number }).time, 0);
  assert.equal((time("+2", old) as { time: number }).time, 52);
  assert.equal((time("start", t44) as { time: number }).time, 0);
  assert.equal((time("end", t44) as { time: number }).time, 64);
  assert.equal((time("end", old) as { code: number }).code, 5);
  assert.equal((time("-40", t44) as { text: string }).text, "the start (clamped)");
  assert.equal((time("1.1.1", { ...t44, den: 32 }) as { code: number }).code, 5);
});

test("units: +Nb bars, +Nq quarters, +N steps of the given size", () => {
  const at = { ...t44, time: 46.5 }; // bar 12 (starts at 44), beat 3.5
  assert.deepEqual(parseTarget("+2b"), { kind: "relative", n: 2, unit: "bar" });
  assert.deepEqual(parseTarget("-3q"), { kind: "relative", n: -3, unit: "quarter" });
  assert.equal((time("+2b", at) as { time: number }).time, 52);
  assert.equal((time("+3q", at) as { time: number }).time, 49); // from the start of beat 3 (46)
  assert.equal((time("-1q", at) as { time: number }).time, 45);
  assert.equal((time("+1", { ...at, step: 2 }) as { time: number }).time, 48); // 2-beat grid: 46 + 2
  assert.equal((time("+1", { ...at, step: 8 }) as { time: number }).time, 48); // 2 bars: on the 8-beat grid, 40 + 8
  assert.equal((time("+2", { ...at, step: 4 }) as { time: number }).time, 52); // a bar step = the old +N
  assert.equal((time("+2b", at) as { text: string }).text, "+2 bars");
  assert.equal((time("+1", at) as { text: string }).text, "+1 step");
  assert.equal((time("-5q", { ...t44, time: 2 }) as { time: number }).time, 0);
});

test("stepBeats: setting, Live's quantization, fallbacks", () => {
  assert.equal(stepBeats("live", 1, 4), 1);
  assert.equal(stepBeats("live", 0, 4), 4); // None
  assert.equal(stepBeats("live", null, 3), 3);
  assert.equal(stepBeats("live", undefined, 4), 4);
  assert.equal(stepBeats("bar", 1, 3), 3);
  assert.equal(stepBeats("2bars", 1, 3), 6);
  assert.equal(stepBeats("eighth", null, 3), 0.5);
  assert.equal(stepBeats("junk", 2, 4), 2);
});
