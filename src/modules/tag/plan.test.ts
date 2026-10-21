import { test } from "node:test";
import assert from "node:assert/strict";
import { changed, normalizeTagNames, planTags, reverseLines, tagIndex } from "./plan.js";

test("names are lowercased, deduped and checked", () => {
  assert.deepEqual(normalizeTagNames(["FX", "#Synth", "fx", "lead_1", "a-b"]), { ok: true, names: ["fx", "synth", "lead_1", "a-b"] });
  assert.deepEqual(normalizeTagNames(["fx", "a b"]), { ok: false, bad: "a b" });
  assert.deepEqual(normalizeTagNames(["ä"]), { ok: false, bad: "ä" });
  assert.deepEqual(normalizeTagNames([""]), { ok: false, bad: "" });
  assert.deepEqual(normalizeTagNames(["#"]), { ok: false, bad: "#" });
});

test("toggle decides per name, add and remove set", () => {
  assert.deepEqual(planTags(["fx"], ["fx", "synth"], "toggle"), { before: ["fx"], after: ["synth"], added: ["synth"], removed: ["fx"] });
  assert.deepEqual(planTags(["fx"], ["fx", "synth"], "add"), { before: ["fx"], after: ["fx", "synth"], added: ["synth"], removed: [] });
  assert.deepEqual(planTags(["fx"], ["fx", "synth"], "remove"), { before: ["fx"], after: [], added: [], removed: ["fx"] });
  assert.equal(changed(planTags(["fx"], ["fx"], "add")), false);
  assert.equal(changed(planTags([], ["fx"], "remove")), false);
});

test("reverse lines put back what changed, quoting paths that need it", () => {
  const c = planTags(["drum"], ["fx", "drum"], "toggle");
  assert.deepEqual(reverseLines("/Lead", c), ["tag --set 0 /Lead fx", "tag --set 1 /Lead drum"]);
  assert.deepEqual(reverseLines("/1 Audio", planTags([], ["fx"], "add")), ['tag --set 0 "/1 Audio" fx']);
  assert.deepEqual(reverseLines("/Lead", planTags(["fx"], ["fx"], "add")), []);
});

test("the tag index lists tags alphabetically with their tracks", () => {
  assert.deepEqual(
    tagIndex([{ path: "/Lead", tags: ["synth", "fx"] }, { path: "/Bass", tags: ["synth"] }, { path: "/Drums" }]),
    [{ tag: "fx", paths: ["/Lead"] }, { tag: "synth", paths: ["/Lead", "/Bass"] }],
  );
});
