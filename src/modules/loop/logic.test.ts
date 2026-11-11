import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLoop, loopHere, parseBars, shouldRestoreLoop } from "./logic.js";

const T = { barStart: 44, barLen: 4, loop: { on: false, start: 0, length: 16 } };

test("loop here: from the bar start, bars long; bad input gives null", () => {
  assert.deepEqual(loopHere(T, 4), { on: true, start: 44, length: 16 });
  assert.deepEqual(loopHere({ ...T, barLen: 3 }, 2), { on: true, start: 44, length: 6 });
  assert.equal(loopHere({ ...T, barLen: 0 }, 4), null);
  for (const b of [0, 65, 1.5, NaN]) assert.equal(loopHere(T, b), null);
});

test("bars argument: integers 1–64 only", () => {
  assert.equal(parseBars("8"), 8);
  assert.equal(parseBars("64"), 64);
  for (const t of ["0", "65", "-1", "1.5", "x", ""]) assert.equal(parseBars(t), null);
});

test("restore only while the loop is still the one we set (small epsilon)", () => {
  const set = { on: true, start: 44, length: 16 };
  assert.equal(shouldRestoreLoop({ on: true, start: 44.0001, length: 16 }, set), true);
  assert.equal(shouldRestoreLoop({ on: true, start: 48, length: 16 }, set), false);
  assert.equal(shouldRestoreLoop({ on: false, start: 44, length: 16 }, set), false);
  assert.equal(shouldRestoreLoop(null, set), false);
});

test("describeLoop: bars are 1-based", () => {
  assert.equal(describeLoop({ ...T, loop: { on: true, start: 44, length: 16 } }), "loop on: from bar 12, 4 bars");
  assert.equal(describeLoop({ ...T, loop: { on: false, start: 0, length: 4 } }), "loop off: from bar 1, 1 bar");
});
