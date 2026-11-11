import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStamp, parseAnswer, trimPosition, NO_POSITION_HINT, type StampTransport } from "./stamp.js";

const NOW = new Date(2026, 10, 11, 14, 5);
const playing: StampTransport = { playing: true, pos: "12.3.1.1" };

test("heading: playing has the position, stopped only the date, no transport adds the hint", () => {
  assert.deepEqual(buildStamp(playing, NOW), { heading: "### @12.3.1 · 2026-11-11 14:05" });
  assert.deepEqual(buildStamp({ ...playing, playing: false }, NOW), { heading: "### 2026-11-11 14:05" });
  assert.deepEqual(buildStamp(null, NOW), { heading: "### 2026-11-11 14:05", hint: NO_POSITION_HINT });
  assert.deepEqual(buildStamp({ ...playing, pos: "junk" }, NOW), { heading: "### 2026-11-11 14:05" });
  assert.equal(trimPosition("101.4.4.240"), "101.4.4");
});

test("page answer: text null / empty / text, then stamp, and junk", () => {
  assert.deepEqual(parseAnswer('{"text":null,"then":null}'), { text: null, then: null });
  assert.deepEqual(parseAnswer('{"text":"","then":null}'), { text: "", then: null });
  assert.deepEqual(parseAnswer('{"text":"a\\nb","then":"stamp"}'), { text: "a\nb", then: "stamp" });
  assert.deepEqual(parseAnswer('{"text":"x","then":"view"}'), { text: "x", then: "view" });
  assert.deepEqual(parseAnswer('{"then":"other"}'), { text: null, then: null });
  assert.deepEqual(parseAnswer(null), { text: null, then: null });
  assert.deepEqual(parseAnswer("plain text"), { text: null, then: null, unreadable: true });
  assert.deepEqual(parseAnswer("42"), { text: null, then: null, unreadable: true });
});
