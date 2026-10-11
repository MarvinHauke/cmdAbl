import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTrackValue } from "./trackSetValue.js";

test("toggle flips each track's own state", () => {
  assert.equal(nextTrackValue(false, "toggle"), true);
  assert.equal(nextTrackValue(true, "toggle"), false);
});

test("a fixed value is set regardless of the current state", () => {
  assert.equal(nextTrackValue(false, false), false);
  assert.equal(nextTrackValue(true, false), false);
  assert.equal(nextTrackValue(false, true), true);
  assert.equal(nextTrackValue(true, true), true);
});
