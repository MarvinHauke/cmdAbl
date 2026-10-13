import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHeight, pickWidth } from "./pickSize.js";

test("pickHeight: rows, the preview line and the cap", () => {
  assert.equal(pickHeight(3, false), 120 + 3 * 28);
  assert.equal(pickHeight(3, true), 120 + 3 * 28 + 28);
  assert.equal(pickHeight(100, false), 640);
  assert.equal(pickHeight(100, true), 640);
  assert.equal(pickHeight(18, false), 120 + 18 * 28 > 640 ? 640 : 120 + 18 * 28); // 18 rows fit under the cap
  assert.equal(pickHeight(0, true), 148);
});

test("pickWidth: the fixed minimum, growth with the longest path, the cap", () => {
  assert.equal(pickWidth(10, 5), 560);
  // A 70-character path with a 12-character detail needs more than 560.
  const wide = pickWidth(70, 12);
  assert.ok(wide > 560 && wide <= 880, String(wide));
  assert.equal(pickWidth(70, 12), Math.ceil(70 * 8.05 + 12 * 6.6) + 110);
  assert.equal(pickWidth(400, 40), 880);
});
