import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionDir, filterValidEntries, isValidId, parseStats, repoUrl, statsFresh } from "./guards.js";

test("isValidId accepts <author-slug>.<name-slug>", () => {
  for (const id of ["federico-pepe.snake", "marvinhauke.cmdabl", "a.b", "ben-casey.bbencut", "x1.y2-z3"]) {
    assert.equal(isValidId(id), true, id);
  }
});

test("isValidId rejects traversal and odd shapes", () => {
  for (const id of ["../x", "a/b", "a\\b", ".hidden", "", "a.b/../c", "a..b", "a.b.c", "nodot", "A.b", "a.b ", "-a.b", "a-.b", "a.b\n", "..", "."]) {
    assert.equal(isValidId(id), false, JSON.stringify(id));
  }
  assert.equal(isValidId(undefined), false);
  assert.equal(isValidId(42), false);
});

test("filterValidEntries drops bad ids and counts them", () => {
  const u = "https://github.com/o/r/x.ablx";
  const entries = [
    { id: "a.b", url: u },
    { id: "../x", url: u },
    { id: 7, url: u },
    { id: "c.d", url: u },
    { id: "e.f", url: "file:///etc/passwd" },
    { id: "g.h", url: "-o /tmp/x" },
    { id: "i.j", url: 5 },
  ];
  const r = filterValidEntries(entries);
  assert.deepEqual(r.valid, [{ id: "a.b", url: u }, { id: "c.d", url: u }]);
  assert.equal(r.dropped, 5);
});

test("extensionDir only yields direct children of the root", () => {
  assert.equal(extensionDir("/ext", "a.b"), "/ext/a.b");
  assert.equal(extensionDir("/ext/", "a.b"), "/ext/a.b");
  assert.equal(extensionDir("/ext", "../x"), undefined);
  assert.equal(extensionDir("/ext", "a/b"), undefined);
  assert.equal(extensionDir("/ext", ""), undefined);
});

test("repoUrl derives the repo page from github release/raw URLs", () => {
  assert.equal(repoUrl("https://github.com/o/r/releases/download/v1/x.ablx"), "https://github.com/o/r");
  assert.equal(repoUrl("https://raw.githubusercontent.com/o/r/main/x.ablx"), "https://github.com/o/r");
  assert.equal(repoUrl("https://example.com/o/r/x.ablx"), undefined);
});

test("parseStats keeps index ids with non-negative integers and null downloads", () => {
  const ids = new Set(["a.b", "c.d", "e.f"]);
  const raw = {
    updated: "2026-11-12",
    stats: {
      "a.b": { stars: 3, downloads: 10 },
      "c.d": { stars: 0, downloads: null },
      "e.f": { stars: -1, downloads: 2 },
      "x.y": { stars: 1, downloads: 1 },
    },
  };
  assert.deepEqual([...parseStats(raw, ids)], [
    ["a.b", { stars: 3, downloads: 10 }],
    ["c.d", { stars: 0, downloads: null }],
  ]);
});

test("parseStats drops non-integers and wrong shapes", () => {
  const ids = new Set(["a.b"]);
  assert.equal(parseStats({ stats: { "a.b": { stars: 1.5, downloads: 1 } } }, ids).size, 0);
  assert.equal(parseStats({ stats: { "a.b": { stars: 1, downloads: "9" } } }, ids).size, 0);
  assert.equal(parseStats({ stats: { "a.b": { stars: 1 } } }, ids).size, 0);
  assert.equal(parseStats({ stats: [] }, ids).size, 0);
  assert.equal(parseStats(null, ids).size, 0);
  assert.equal(parseStats("x", ids).size, 0);
});

test("statsFresh: a week or less, a valid date", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  assert.equal(statsFresh({ updated: "2026-11-12" }, now), true);
  assert.equal(statsFresh({ updated: "2026-11-06" }, now), true);
  assert.equal(statsFresh({ updated: "2026-11-01" }, now), false);
  assert.equal(statsFresh({ updated: "soon" }, now), false);
  assert.equal(statsFresh({}, now), false);
  assert.equal(statsFresh(null, now), false);
});
