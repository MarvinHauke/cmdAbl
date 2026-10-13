import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeApi } from "./testPorts.js";
import type { ObjectNode } from "../ableton/objectTree.js";

const node: ObjectNode = { handleId: "1", route: [0], kind: "track", scope: "regular", name: "Kick", path: "/Kick", children: [] };

test("fake api: the ports record what a module does", async () => {
  const fake = createFakeApi({ nodes: [node], dialogAnswer: "install:x" });
  const { api } = fake;
  assert.deepEqual(api.liveSet.nodes(), [node]);
  api.tracks.transaction(() => {
    api.tracks.track(node)!.mute = true;
  });
  assert.equal(fake.transactions, 1);
  assert.equal(fake.tracks.get("1")?.mute, true);
  assert.equal(api.tracks.track({ ...node, handleId: "gone" }), null);
  assert.equal(api.tracks.track({ ...node, kind: "chain" }), null); // a chain is not a track
  api.log("hello");
  assert.deepEqual(fake.logs, ["hello"]);
  assert.equal(await api.dialog("<p>", 10, 20), "install:x");
  assert.deepEqual(fake.dialogs, [{ html: "<p>", width: 10, height: 20 }]);
  assert.equal((await api.bridge.available()).ok, true);
});

test("fake api: pick answers from pickAnswer and notifies onPick listeners", async () => {
  const fake = createFakeApi({ nodes: [node], pickAnswer: (c) => [c[0]!] });
  const seen: Array<string[] | null> = [];
  fake.api.onPick((_c, chosen) => seen.push(chosen?.map((n) => n.path) ?? null));
  assert.deepEqual((await fake.api.pick("t", [node]))?.map((n) => n.path), ["/Kick"]);
  assert.deepEqual(seen, [["/Kick"]]);
  assert.equal(await createFakeApi().api.pick("t", [node]), null);
});
