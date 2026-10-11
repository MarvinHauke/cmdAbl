import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTrackValue, uniqueTracks } from "./trackSetValue.js";

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

test("uniqueTracks keeps one node per track position", () => {
  const a = { scope: "track", route: [0], path: "/a" };
  const aAgain = { scope: "track", route: [0], path: "/drums/a" };
  const b = { scope: "track", route: [1], path: "/b" };
  const ret0 = { scope: "return", route: [0], path: "/ret" };
  assert.deepEqual(uniqueTracks([a, aAgain, b, ret0]), [a, b, ret0]);
});
