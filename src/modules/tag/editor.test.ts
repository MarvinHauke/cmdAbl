import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEditor, finalTags, mergesOf, parseAnswer, type EditorTrack } from "./editor.js";
import { listEnterLine, listRows } from "./list.js";

const tracks: EditorTrack[] = [
  { id: "a", name: "Kick", group: "Drums", tags: ["drums", "fx"] },
  { id: "b", name: "Lead", tags: [] },
];
const opts = { view: "list", filter: "compact", gear: true } as const;

test("buildEditor: tags sorted with their track ids, Set order kept, focus on the first tag or the one asked for", () => {
  const data = buildEditor(tracks, opts);
  assert.deepEqual(data.tags, [{ name: "drums", tracks: ["a"] }, { name: "fx", tracks: ["a"] }]);
  assert.deepEqual(data.tracks[0], { id: "a", name: "Kick", group: "Drums" });
  assert.deepEqual(data.focus, { tag: "drums" });
  assert.deepEqual(buildEditor(tracks, { ...opts, focusTag: "zz", focusTrack: "b" }).focus, { tag: "zz", track: "b" });
  assert.deepEqual(buildEditor([], opts).focus, undefined);
});

test("parseAnswer: closed, settings and a bad shape", () => {
  const req = buildEditor(tracks, opts);
  assert.equal(parseAnswer(null, req).kind, "closed");
  assert.equal(parseAnswer('{"settings":true}', req).kind, "settings");
  assert.equal(parseAnswer("[1]", req).kind, "error");
  assert.equal(parseAnswer('"x"', req).kind, "error");
});

test("finalTags: renames merge, removals win over sets, off beats nothing", () => {
  const req = buildEditor(tracks, opts);
  const parsed = parseAnswer(JSON.stringify({ apply: { rename: [{ from: "fx", to: "drums" }], set: [{ tag: "x", track: "b", on: true }] } }), req);
  assert.equal(parsed.kind, "apply");
  if (parsed.kind !== "apply") return;
  assert.deepEqual(finalTags(["drums", "fx"], "a", parsed.edits), ["drums"]);
  assert.deepEqual(finalTags([], "b", parsed.edits), ["x"]);
  assert.deepEqual(mergesOf(tracks, parsed.edits), [["fx", "drums"]]);
});

test("a removed tag is never set again", () => {
  const req = buildEditor(tracks, opts);
  const parsed = parseAnswer(JSON.stringify({ apply: { remove: ["fx"], set: [{ tag: "fx", track: "b", on: true }] } }), req);
  assert.equal(parsed.kind, "apply");
  if (parsed.kind === "apply") assert.deepEqual(finalTags([], "b", parsed.edits), []);
});

test("listRows and listEnterLine", () => {
  const rows = listRows([
    { name: "A", path: "/A", tags: ["x"] },
    { name: "B", path: "/B", tags: [] },
  ]);
  assert.deepEqual(rows.map((r) => [r.label, r.detail, r.tag]), [["#x", "1 · A", "x"], ["untagged", "1 · B", undefined]]);
  assert.equal(listEnterLine("find #{}", "fx"), "find #fx");
  const many = listRows(Array.from({ length: 10 }, (_, i) => ({ name: `T${i}`, path: `/T${i}`, tags: ["x"] })));
  assert.match(many[0]!.detail, /^10 · T0, .*T7, \+2$/);
});
