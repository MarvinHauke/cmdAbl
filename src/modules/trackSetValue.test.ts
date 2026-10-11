import { test } from "node:test";
import assert from "node:assert/strict";
import { armDecision, nextTrackValue, notChanged } from "./trackSetValue.js";

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

test("armDecision: regular tracks are written, return/main are refused or skipped", () => {
  assert.equal(armDecision("regular", true), "write");
  assert.equal(armDecision("regular", false), "write");
  assert.equal(armDecision(undefined, true), "write");
  assert.equal(armDecision("return", true), "refuse");
  assert.equal(armDecision("master", true), "refuse");
  assert.equal(armDecision("return", false), "skip");
  assert.equal(armDecision("master", false), "skip");
});

test("notChanged compares what was written with what reads back", () => {
  assert.equal(notChanged(true, true), false);
  assert.equal(notChanged(false, false), false);
  assert.equal(notChanged(true, false), true);
  assert.equal(notChanged(false, true), true);
});
