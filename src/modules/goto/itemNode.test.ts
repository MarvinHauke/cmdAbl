import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { findItemNode } from "./itemNode.js";

const n = (handleId: string, kind: "track" | "device" | "chain", route: number[], scope: ObjectNode["scope"] = "regular"): ObjectNode => ({
  handleId, route, kind, scope, name: handleId, path: `/${handleId}`, children: [],
}) as ObjectNode;
const nodes = [n("1", "track", [0]), n("2", "device", [0, 0]), n("3", "track", [0], "return"), n("4", "chain", [0, 0, 1])];

test("findItemNode: by handle id, then by scope and route", () => {
  assert.equal(findItemNode(nodes, { type: "device", id: "2" })?.handleId, "2");
  assert.equal(findItemNode(nodes, { type: "track", id: "gone", route: [0], scope: "return" })?.handleId, "3");
  assert.equal(findItemNode(nodes, { type: "track", id: "gone", route: [0] })?.handleId, "1");
  assert.equal(findItemNode(nodes, { type: "track", id: "gone", route: [9] }), undefined);
  // chains: by handle id, then by the three-part route; never confused with a device on the same route prefix
  assert.equal(findItemNode(nodes, { type: "chain", id: "4" })?.handleId, "4");
  assert.equal(findItemNode(nodes, { type: "chain", id: "gone", route: [0, 0, 1] })?.handleId, "4");
  assert.equal(findItemNode(nodes, { type: "chain", id: "gone", route: [0, 0] }), undefined);
  assert.equal(findItemNode(nodes, { type: "command", id: "2" } as never), undefined);
});
