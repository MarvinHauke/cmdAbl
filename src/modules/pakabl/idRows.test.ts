import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdRows } from "./idRows.js";

function setup() {
  const calls = { stamp: 0, load: 0 };
  const state = { stamp: 1 as number | undefined, entries: [{ id: "a.one", name: "One", version: "1.0.0" }, { id: "b.two", name: "Two", version: "2.0.0" }], installed: new Set(["b.two"]) };
  const rows = createIdRows({
    stamp: () => (calls.stamp++, state.stamp),
    load: () => (calls.load++, state.entries),
    installed: (id) => state.installed.has(id),
  });
  return { calls, state, rows };
}

test("the index is parsed once; later calls cost one stat", () => {
  const { calls, rows } = setup();
  assert.deepEqual(rows.rows(false).map((r) => r.label), ["a.one", "b.two"]);
  assert.equal(rows.rows(false)[0]!.description, "One v1.0.0");
  rows.rows(true);
  assert.equal(calls.load, 1);
  assert.equal(calls.stamp, 3);
});

test("installedOnly keeps the entries that are installed now", () => {
  const { state, rows } = setup();
  assert.deepEqual(rows.rows(true).map((r) => r.label), ["b.two"]);
  state.installed.add("a.one");
  assert.deepEqual(rows.rows(true).map((r) => r.label), ["a.one", "b.two"]);
});

test("a changed mtime or invalidate() re-reads; a missing file gives no rows", () => {
  const { calls, state, rows } = setup();
  rows.rows(false);
  state.stamp = 2;
  state.entries = [{ id: "c.three", name: "Three", version: "3.0.0" }];
  assert.deepEqual(rows.rows(false).map((r) => r.label), ["c.three"]);
  rows.invalidate();
  rows.rows(false);
  assert.equal(calls.load, 3);
  state.stamp = undefined;
  assert.deepEqual(rows.rows(false), []);
  assert.equal(calls.load, 3);
});

test("a hot call is fast even with a big index", () => {
  const entries = Array.from({ length: 2000 }, (_, i) => ({ id: `a.x${i}`, name: `X${i}`, version: "1.0.0" }));
  const rows = createIdRows({ stamp: () => 1, load: () => entries, installed: () => false });
  rows.rows(false);
  const t = performance.now();
  for (let i = 0; i < 100; i++) rows.rows(false);
  const perCall = (performance.now() - t) / 100;
  assert.ok(perCall < 1, `${perCall} ms per call`);
});
