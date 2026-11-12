import { test } from "node:test";
import assert from "node:assert/strict";
import { behindSongEnd, beatsToPosition, friendlyRefusal } from "./position.js";

const S44 = { num: 4, den: 4 };

test("beatsToPosition inverts positionToBeats", () => {
  assert.deepEqual(beatsToPosition(232, S44), { bar: 59, beat: 1, six: 1 });
  assert.deepEqual(beatsToPosition(230, S44), { bar: 58, beat: 3, six: 1 });
  assert.deepEqual(beatsToPosition(11 * 3 + 1, { num: 6, den: 8 }), { bar: 12, beat: 3, six: 1 });
  assert.equal(beatsToPosition(5, { num: 0, den: 0 }), null);
});

test("behindSongEnd: only beyond the length; the end is a position; no contradiction", () => {
  assert.equal(behindSongEnd(232, 232, S44), null);
  assert.equal(behindSongEnd(980, 232, S44), "246.1.1 is too far: Live lets the playhead go only up to 59.1.1 here (the last clip or automation + 8 bars, the loop's end, or the playhead + 8 bars)");
  assert.equal(behindSongEnd(232.25, 232, S44), "59.1.2 is too far: Live lets the playhead go only up to 59.1.1 here (the last clip or automation + 8 bars, the loop's end, or the playhead + 8 bars)");
  assert.equal(behindSongEnd(231, 230, S44), "58.4.1 is too far: Live lets the playhead go only up to 58.3.1 here (the last clip or automation + 8 bars, the loop's end, or the playhead + 8 bars)");
  assert.equal(behindSongEnd(980, 0, S44), null);
  assert.equal(behindSongEnd(980, 232, { num: 0, den: 0 }), "that is too far for Live (the last clip or automation + 8 bars, the loop's end, or the playhead + 8 bars)");
});

test("friendlyRefusal maps the two known Live texts and leaves others", () => {
  assert.equal(friendlyRefusal("Live refused the jump: RuntimeError: Cannot set the Songtime behind the Songlength"), "that is too far for Live (the last clip or automation + 8 bars, the loop's end, or the playhead + 8 bars)");
  assert.equal(friendlyRefusal("Live refused the loop: RuntimeError: loop end behind the Songlength"), "that is too far for Live (the last clip or automation + 8 bars, the loop's end, or the playhead + 8 bars)");
  assert.equal(friendlyRefusal("other"), "other");
});
