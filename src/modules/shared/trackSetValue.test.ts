import { test } from "node:test";
import assert from "node:assert/strict";
import { armDecision, armRefusal, isGroupNode, nextTrackValue, notChanged } from "./trackSetValue.js";

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

test("armDecision: group tracks are refused or skipped like return/main", () => {
  assert.equal(armDecision("regular", true, true), "refuse");
  assert.equal(armDecision("regular", false, true), "skip");
  assert.equal(armDecision("regular", true, false), "write");
});

test("isGroupNode: track children make a group, devices alone do not", () => {
  const device = { kind: "device" };
  const track = { kind: "track" };
  assert.equal(isGroupNode({ children: [] }), false);
  assert.equal(isGroupNode({ children: [device, device] }), false);
  assert.equal(isGroupNode({ children: [track, device] }), true);
  // a nested group is a group by its own children
  assert.equal(isGroupNode({ children: [track] }), true);
});

test("armRefusal names group tracks", () => {
  assert.equal(armRefusal(true), "group tracks cannot be armed");
  assert.equal(armRefusal(false), "cannot be armed");
});
