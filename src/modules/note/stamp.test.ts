import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStamp, loopForStamp, parseAnswer, shouldRestoreLoop, trimPosition, NO_POSITION_HINT, type StampTransport } from "./stamp.js";

const NOW = new Date(2026, 10, 11, 14, 5);
const playing: StampTransport = { playing: true, session: false, pos: "12.3.1.1", barStart: 44, barLen: 4, loop: { on: false, start: 0, length: 16 } };

test("heading: playing has the position, stopped only the date, no transport adds the hint", () => {
  assert.deepEqual(buildStamp(playing, NOW), { heading: "### @12.3.1 · 2026-11-11 14:05" });
  assert.deepEqual(buildStamp({ ...playing, playing: false }, NOW), { heading: "### 2026-11-11 14:05" });
  assert.deepEqual(buildStamp(null, NOW), { heading: "### 2026-11-11 14:05", hint: NO_POSITION_HINT });
  assert.deepEqual(buildStamp({ ...playing, session: true }, NOW), { heading: "### @12.3.1 · 2026-11-11 14:05" });
  assert.deepEqual(buildStamp({ ...playing, pos: "junk" }, NOW), { heading: "### 2026-11-11 14:05" });
  assert.equal(trimPosition("101.4.4.240"), "101.4.4");
});

test("loop for a stamp: only Arrangement playback with the setting on", () => {
  assert.deepEqual(loopForStamp(playing, true, 4), { on: true, start: 44, length: 16 });
  assert.equal(loopForStamp(playing, false, 4), null);
  assert.equal(loopForStamp(null, true, 4), null);
  assert.equal(loopForStamp({ ...playing, playing: false }, true, 4), null);
  assert.equal(loopForStamp({ ...playing, session: true }, true, 4), null);
});

test("restore only while the loop is still the one we set (small epsilon)", () => {
  const set = { on: true, start: 44, length: 16 };
  assert.equal(shouldRestoreLoop({ on: true, start: 44.0001, length: 16 }, set), true);
  assert.equal(shouldRestoreLoop({ on: true, start: 48, length: 16 }, set), false);
  assert.equal(shouldRestoreLoop({ on: false, start: 44, length: 16 }, set), false);
  assert.equal(shouldRestoreLoop(null, set), false);
});

test("page answer: text null / empty / text, then stamp, and junk", () => {
  assert.deepEqual(parseAnswer('{"text":null,"then":null}'), { text: null, then: null });
  assert.deepEqual(parseAnswer('{"text":"","then":null}'), { text: "", then: null });
  assert.deepEqual(parseAnswer('{"text":"a\\nb","then":"stamp"}'), { text: "a\nb", then: "stamp" });
  assert.deepEqual(parseAnswer('{"then":"other"}'), { text: null, then: null });
  assert.deepEqual(parseAnswer(null), { text: null, then: null });
  assert.deepEqual(parseAnswer("plain text"), { text: null, then: null, unreadable: true });
  assert.deepEqual(parseAnswer("42"), { text: null, then: null, unreadable: true });
});
