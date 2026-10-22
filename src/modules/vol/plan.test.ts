import { test } from "node:test";
import assert from "node:assert/strict";
import { faderMove, formatDb, formatSigned, parseDb, planAbsolute } from "./plan.js";
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

test("absolute: the fader goes to the level whatever it was", () => {
  const p = planAbsolute(dbToValue(-20).value, -6);
  assert.ok(Math.abs(p.newDb - -6) <= 0.1);
  assert.equal(p.limit, undefined);
});

test("past +6 dB the fader stops at the maximum and says so; -inf is allowed", () => {
  const p = planAbsolute(0.85, 9);
  assert.deepEqual([p.newValue, p.limit], [1, "max"]);
  const off = planAbsolute(0.85, -Infinity);
  assert.deepEqual([off.newValue, off.limit], [0, "-inf"]);
});

test("a move to the level the fader shows already is no move", () => {
  assert.equal(faderMove(dbToValue(-6).value, -6.02).same, true);
  assert.equal(faderMove(0, -Infinity).same, true);
  assert.equal(faderMove(dbToValue(-6).value, -12).same, false);
});

test("formatSigned puts a plus before positive levels", () => {
  assert.equal(formatSigned(3), "+3.0");
  assert.equal(formatSigned(-3), "-3.0");
  assert.equal(formatSigned(0), "0.0");
  assert.equal(formatSigned(-Infinity), "-inf");
});
