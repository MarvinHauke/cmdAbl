import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHeight } from "./pickSize.js";

test("pickHeight: rows, the preview line and the cap", () => {
  assert.equal(pickHeight(3, false), 120 + 3 * 28);
  assert.equal(pickHeight(3, true), 120 + 3 * 28 + 28);
  assert.equal(pickHeight(100, false), 420);
  assert.equal(pickHeight(100, true), 420);
  assert.equal(pickHeight(0, true), 148);
});
