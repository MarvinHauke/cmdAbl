import { test } from "node:test";
import assert from "node:assert/strict";
import { buildListPage } from "./listPage.js";

const template = "<script>const ENTRIES = /*ENTRIES_PLACEHOLDER*/null;</script>";

function entriesFrom(html: string): unknown {
  const m = /const ENTRIES = (.*);<\/script>$/s.exec(html);
  assert.ok(m, "page keeps a single script block");
  return JSON.parse(m[1]!);
}

test("entries survive a round trip", () => {
  const entries = [{ id: "a.b", name: "Plain", version: "1.0.0" }];
  assert.deepEqual(entriesFrom(buildListPage(template, entries)), entries);
});

test("a name with </script> cannot end the script block", () => {
  const entries = [{ id: "x", name: "</script><img src=x onerror=alert(1)>", version: "1" }];
  const html = buildListPage(template, entries);
  assert.equal(html.split("</script>").length, 2);
  assert.deepEqual(entriesFrom(html), entries);
});

test("$-patterns in the data are kept literally", () => {
  const entries = [{ id: "x", name: "$& $` $' $1 $$", version: "1" }];
  assert.deepEqual(entriesFrom(buildListPage(template, entries)), entries);
});

test("a template without the placeholder fails loudly", () => {
  assert.throws(() => buildListPage("<script>const ENTRIES = [];</script>", []), /placeholder/);
});
