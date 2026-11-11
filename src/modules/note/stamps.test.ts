import { test } from "node:test";
import assert from "node:assert/strict";
import { listCursor, nextStamp, parseStamps, prevStamp } from "./stamps.js";

const note = [
  "# Notes",
  "### @12.3.1 · 2026-11-11 14:32",
  "Fix the **kick** here",
  "and more words after it",
  "### 2026-11-10 09:00",
  "stopped idea",
  "### @4.1.1 · 2026-11-11 15:00",
  "```",
  "### @99.1.1 · 2026-01-01 00:00",
  "```",
  "### @0.1.1 · 2026-11-11 15:00",
  "### Something else",
  "### @20.2.3 · 2026-11-12 08:00",
].join("\n");
const stamps = parseStamps(note);
const at = (bar: number, beat = 1, six = 1) => ({ bar, beat, six });

test("parseStamps reads positioned and date-only headings, skips fences, bad bars and other headings", () => {
  assert.deepEqual(stamps.map((s) => s.position && `${s.position.bar}.${s.position.beat}.${s.position.six}`), ["12.3.1", null, "4.1.1", "20.2.3"]);
  assert.equal(stamps[0]?.preview, "Fix the kick here and more words after");
  assert.equal(stamps[1]?.preview, "stopped idea");
  assert.equal(stamps[2]?.preview, "");
});

test("malformed headings are ignored", () => {
  assert.deepEqual(parseStamps("### @12.3 · 2026-11-11\n### @a.b.c · x\n## @1.1.1 · 2026-11-11 10:00\ntext"), []);
  assert.deepEqual(parseStamps(""), []);
});

test("next and prev go by position, strictly", () => {
  assert.equal(nextStamp(stamps, at(5), false)?.position?.bar, 12);
  assert.equal(nextStamp(stamps, at(12, 3, 1), false)?.position?.bar, 20);
  assert.equal(prevStamp(stamps, at(12, 3, 1), false)?.position?.bar, 4);
  assert.equal(prevStamp(stamps, at(12, 3, 2), false)?.position?.bar, 12);
});

test("at the ends: none, or wrap", () => {
  assert.equal(nextStamp(stamps, at(21), false), null);
  assert.equal(nextStamp(stamps, at(21), true)?.position?.bar, 4);
  assert.equal(prevStamp(stamps, at(1), false), null);
  assert.equal(prevStamp(stamps, at(1), true)?.position?.bar, 20);
  assert.equal(nextStamp(parseStamps("### 2026-11-10 09:00"), at(1), true), null);
});

test("list cursor: the next stamp after the playhead, else the first positioned row", () => {
  assert.equal(listCursor(stamps, at(5)), 0); // 12.3.1 is the next after bar 5
  assert.equal(listCursor(stamps, at(13)), 3);
  assert.equal(listCursor(stamps, at(30)), 0);
  assert.equal(listCursor(stamps, null), 0);
  assert.equal(listCursor(parseStamps("### 2026-11-10 09:00\n### @2.1.1 · 2026-11-10 09:00"), null), 1);
});
