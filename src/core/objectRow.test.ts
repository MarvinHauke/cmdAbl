import { test } from "node:test";
import assert from "node:assert/strict";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../ableton/objectTree.js";
import { objectRowLine } from "./objectRow.js";

let id = 0;
const node = (name: string, children: ObjectNode[] = []): ObjectNode => ({
  handleId: `h${++id}`, route: [id], kind: "track", scope: "regular", name, path: "", children,
});
const roots = [node("Opal Lead"), node("Kick"), node("Kick")];
assignPaths(roots, "");
const nodes = flattenObjectTree(roots);

test("objectRowLine: the unique path, quoted where needed", () => {
  assert.equal(objectRowLine({ id: nodes[0]!.handleId }, nodes), 'goto "/Opal Lead"');
  assert.equal(objectRowLine({ id: nodes[1]!.handleId }, nodes), "goto /Kick#1"); // first of two same-named
  assert.equal(objectRowLine({ id: nodes[2]!.handleId }, nodes), "goto /Kick#2");
});

test("objectRowLine: a vanished object falls back to its path text, never to its route", () => {
  assert.equal(objectRowLine({ id: "gone", path: "/Opal Lead" }, nodes), 'goto "/Opal Lead"');
  assert.equal(objectRowLine({ id: "gone" }, nodes), null);
});
