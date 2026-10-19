import { test } from "node:test";
import assert from "node:assert/strict";
import { HistoryStore, MAX_ENTRIES, MAX_REMOVED } from "./store.js";

const filled = (...texts: string[]) => {
  const s = new HistoryStore();
  for (const t of texts) s.record(t);
  return s;
};

test("record keeps the newest first, dedupes and caps", () => {
  const s = filled("a", "b", "a");
  assert.deepEqual(s.list(), ["a", "b"]);
  const big = new HistoryStore();
  for (let i = 0; i < MAX_ENTRIES + 5; i++) big.record(`c${i}`);
  assert.equal(big.size, MAX_ENTRIES);
  assert.equal(big.list()[0], `c${MAX_ENTRIES + 4}`);
});

test("forget moves the newest N aside and restore puts them back in place", () => {
  const s = filled("a", "b", "c", "d");
  assert.equal(s.forget(2), 2);
  assert.deepEqual(s.list(), ["b", "a"]);
  assert.equal(s.restore(), 2);
  assert.deepEqual(s.list(), ["d", "c", "b", "a"]);
  assert.equal(s.removedSize, 0);
});

test("restore without a count takes only the last batch, with a count the most recent entries", () => {
  const s = filled("a", "b", "c");
  s.forget(1); // c
  s.forget(1); // b
  assert.equal(s.restore(), 1); // the last batch: b
  assert.deepEqual(s.list(), ["b", "a"]);
  s.forget(2); // b, a
  assert.equal(s.restore(1), 1); // most recently removed first: b
  assert.deepEqual(s.list(), ["b"]);
});

test("restored entries sit by age below newer runs and skip texts that are back", () => {
  const s = filled("a", "b");
  s.forget();
  s.record("c");
  s.record("a");
  assert.equal(s.restore(), 1); // a is already there, b returns
  assert.deepEqual(s.list(), ["a", "c", "b"]);
});

test("restore respects the cap and counts only entries that fit", () => {
  const s = new HistoryStore();
  for (let i = 0; i < MAX_ENTRIES; i++) s.record(`old${i}`);
  s.forget();
  for (let i = 0; i < MAX_ENTRIES; i++) s.record(`new${i}`);
  assert.equal(s.restore(), 0);
  assert.equal(s.size, MAX_ENTRIES);
  assert.ok(s.list().every((t) => t.startsWith("new")));
});

test("the removed stack holds at most MAX_REMOVED and wipe empties both", () => {
  const s = new HistoryStore();
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < MAX_ENTRIES; i++) s.record(`r${round}-${i}`);
    s.forget();
  }
  assert.equal(s.removedSize, MAX_REMOVED);
  s.record("x");
  assert.equal(s.wipe(), 1);
  assert.equal(s.size, 0);
  assert.equal(s.removedSize, 0);
  assert.equal(s.restore(), 0);
});
