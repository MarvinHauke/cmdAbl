import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRelative } from "./relative.js";

const bounds = { min: -69.6, max: 6 };

test("stop: the step is cut to the nearest end and every member moves by the same amount", () => {
  const r = applyRelative([-6, 3, -3], 9, "stop", bounds);
  assert.equal(r.applied, 3);
  assert.deepEqual(r.newLevels, [-3, 6, 0]);
  assert.deepEqual(r.limited, [1]);
});

test("stop: a step that fits is applied as asked and nothing is limited", () => {
  const r = applyRelative([-6, -3], 2, "stop", bounds);
  assert.deepEqual([r.applied, r.newLevels, r.limited], [2, [-4, -1], []]);
  const exact = applyRelative([0, 3], 3, "stop", bounds); // lands on the end, not past it
  assert.deepEqual([exact.applied, exact.limited], [3, []]);
});

test("stop downward: the floor is the lowest finite level, never -inf", () => {
  const r = applyRelative([-60, -20], -30, "stop", bounds);
  assert.ok(Math.abs(r.applied - -9.6) < 1e-9);
  assert.ok(Math.abs(r.newLevels[0]! - -69.6) < 1e-9);
  assert.ok(Math.abs(r.newLevels[1]! - -29.6) < 1e-9);
  assert.deepEqual(r.limited, [0]);
});

test("stop: members at -inf are left out and stay; they do not block the step", () => {
  const r = applyRelative([-Infinity, -6], 4, "stop", bounds);
  assert.deepEqual([r.applied, r.newLevels, r.limited], [4, [-Infinity, -2], []]);
  const none = applyRelative([-Infinity], 4, "stop", bounds);
  assert.deepEqual([none.applied, none.newLevels, none.limited], [0, [-Infinity], []]);
});

test("stop: a step shrunk to 0 moves nothing", () => {
  const r = applyRelative([6, 0], 3, "stop", bounds);
  assert.equal(r.applied, 0);
  assert.deepEqual(r.newLevels, [6, 0]);
  assert.deepEqual(r.limited, [0]);
  assert.equal(applyRelative([1], 0, "stop", bounds).applied, 0);
});

test("clip: every member follows the step, those past an end are clamped; past the bottom goes to -inf", () => {
  const r = applyRelative([-6, 5, -65], 3, "clip", bounds);
  assert.deepEqual(r.newLevels, [-3, 6, -62]);
  assert.deepEqual(r.limited, [1]);
  const down = applyRelative([-65, -10], -10, "clip", bounds);
  assert.deepEqual(down.newLevels, [-Infinity, -20]);
  assert.deepEqual(down.limited, [0]);
  assert.equal(down.applied, -10);
});

test("clip: a member at -inf stays and is not listed, its step was cut by nothing", () => {
  const r = applyRelative([-Infinity, -6], 2, "clip", bounds);
  assert.deepEqual([r.newLevels, r.limited], [[-Infinity, -4], []]);
  assert.deepEqual(applyRelative([-Infinity], 0, "clip", bounds).limited, []);
});
