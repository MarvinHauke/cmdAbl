import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionDir, filterValidEntries, isKnownRepoUrl, isValidId, repoUrl } from "./guards.js";

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

test("isKnownRepoUrl opens only repo URLs derived from index entries", () => {
  const entries = [{ url: "https://github.com/o/r/releases/download/v1/x.ablx" }];
  assert.equal(isKnownRepoUrl("https://github.com/o/r", entries), true);
  assert.equal(isKnownRepoUrl("https://github.com/o/other", entries), false);
  assert.equal(isKnownRepoUrl("http://github.com/o/r", entries), false);
  assert.equal(isKnownRepoUrl("file:///etc/passwd", entries), false);
  assert.equal(isKnownRepoUrl("", entries), false);
});
