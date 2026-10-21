import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDb, parseDb, planFader } from "./plan.js";
import { dbToValue } from "../mixValue.js";

test("parseDb takes numbers, signs, a leading dot and -inf; nothing else", () => {
  assert.equal(parseDb("-6"), -6);
  assert.equal(parseDb("+2"), 2);
  assert.equal(parseDb("-0.5"), -0.5);
  assert.equal(parseDb(".5"), 0.5);
  assert.equal(parseDb("-inf"), -Infinity);
  assert.equal(parseDb("-INF"), -Infinity);
  for (const bad of ["", "abc", "--6", "1e3", "6,5", "#drums", "-", "3dB", "inf", "+inf"]) assert.equal(parseDb(bad), null, bad);
});

test("formatDb: one decimal, -inf, no negative zero", () => {
  assert.equal(formatDb(-6), "-6.0");
  assert.equal(formatDb(-0.04), "0.0");
  assert.equal(formatDb(2.26), "2.3");
  assert.equal(formatDb(-Infinity), "-inf");
});

test("relative: the step is added to where the fader is", () => {
  const kick = dbToValue(-6).value;
  const p = planFader(kick, -6, false);
  assert.ok(Math.abs(p.newDb - -12) <= 0.1);
  assert.equal(p.limit, undefined);
  assert.equal(p.same, false);
});

test("absolute: the fader goes to the level whatever it was", () => {
  const p = planFader(dbToValue(-20).value, -6, true);
  assert.ok(Math.abs(p.newDb - -6) <= 0.1);
});

test("past +6 dB the fader stops at the maximum and says so; -inf is allowed for --set", () => {
  const p = planFader(dbToValue(5).value, 4, false);
  assert.deepEqual([p.newValue, p.limit], [1, "max"]);
  const off = planFader(0.85, -Infinity, true);
  assert.deepEqual([off.newValue, off.limit], [0, "-inf"]);
});

test("a relative step on a fader at -inf stays and reports the limit; a step of 0 reports nothing", () => {
  const p = planFader(0, 3, false);
  assert.deepEqual([p.newValue, p.limit, p.same], [0, "-inf", true]);
  const zero = planFader(0, 0, false);
  assert.deepEqual([zero.limit, zero.same], [undefined, true]);
  const down = planFader(dbToValue(-60).value, -20, false);
  assert.equal(down.limit, "-inf");
  assert.equal(down.newValue, 0);
});
