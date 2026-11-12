import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeApi } from "./testPorts.js";
import type { ObjectNode } from "../../ableton/objectTree.js";

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

test("fake api: confirm answers from confirmAnswer (default false) and records the message", async () => {
  const no = createFakeApi({});
  assert.equal(await no.api.confirm("Sure?", "Yes"), false);
  const yes = createFakeApi({ confirmAnswer: true });
  assert.equal(await yes.api.confirm("Sure?", "Yes"), true);
  assert.deepEqual(yes.confirms, ["Sure?"]);
});

test("fake api: tags and pickTags", async () => {
  const fake = createFakeApi({ nodes: [node], tags: { [node.handleId]: ["fx"] }, pickTagsAnswer: (rows) => [rows[0]!.name] });
  assert.deepEqual(fake.api.tags.of(node), ["fx"]);
  const written = await fake.api.tags.write(node, ["fx", "synth"]);
  assert.equal(written.ok, true);
  assert.deepEqual(fake.api.tags.of(node), ["fx", "synth"]);
  await fake.api.tags.write(node, []);
  assert.deepEqual(fake.api.tags.of(node), []);
  assert.equal((await fake.api.tags.refresh()).ok, true);
  assert.deepEqual(await fake.api.pickTags("tag /Bass", [{ name: "fx", on: true }]), ["fx"]);
  assert.deepEqual(fake.tagLists, [{ title: "tag /Bass", rows: [{ name: "fx", on: true }] }]);
  assert.equal(await createFakeApi().api.pickTags("t", []), null);
});

test("fake api.files.readResult: ok, missing, failed (unreadable or a bad name)", async () => {
  const fake = createFakeApi({ files: { "a.json": "{}" } });
  assert.deepEqual(await fake.api.files.readResult("a.json"), { status: "ok", text: "{}" });
  assert.deepEqual(await fake.api.files.readResult("b.json"), { status: "missing" });
  fake.unreadableFiles.add("a.json");
  assert.deepEqual(await fake.api.files.readResult("a.json"), { status: "failed", reason: "EACCES" });
  assert.equal(await fake.api.files.read("a.json"), null); // read answers null for a failing file too
  assert.equal((await fake.api.files.readResult("../x")).status, "failed");
});

test("fake api.midi.blocked / onBlocked: a rebuild is simulated by changing midiBlocked and calling the listeners", () => {
  const fake = createFakeApi();
  assert.deepEqual(fake.api.midi.blocked(), []);
  const heard: Array<string[] | null> = [];
  const off = fake.api.midi.onBlocked((b) => heard.push(b));
  fake.midiBlocked = ["CC51/ch1"];
  for (const l of fake.blockedListeners) l(fake.api.midi.blocked());
  assert.deepEqual(heard, [["CC51/ch1"]]);
  fake.midiBlocked = null;
  assert.equal(fake.api.midi.blocked(), null);
  off();
  assert.equal(fake.blockedListeners.length, 0);
});

test("fake api.midi.onEvent: listeners are kept in fake.eventListeners and can be removed", () => {
  const fake = createFakeApi();
  const heard: number[] = [];
  const off = fake.api.midi.onEvent((e) => heard.push(e.number));
  for (const l of fake.eventListeners) l({ seq: 1, type: "cc", channel: 1, number: 7, value: 1, time: 0, monitor: true });
  assert.deepEqual(heard, [7]);
  off();
  assert.equal(fake.eventListeners.length, 0);
});

test("fake api: set.jump records the time, moves the fake transport and can fail", async () => {
  const transport = { playing: true, session: false, pos: "1.1.1.1", time: 0, barStart: 0, barLen: 4, sigNum: 4, sigDen: 4, songLength: 100, loop: { on: false, start: 0, length: 16 } };
  const fake = createFakeApi({ transport });
  assert.deepEqual(await fake.api.set.jump(12), { ok: true, time: 12 });
  assert.equal(fake.transport?.time, 12);
  fake.jumpFails = { code: 1, text: "refused" };
  assert.deepEqual(await fake.api.set.jump(20), { ok: false, code: 1, text: "refused" });
  assert.deepEqual(fake.jumps, [12, 20]);
  assert.equal(fake.transport?.time, 12);
  const none = createFakeApi();
  assert.deepEqual(await none.api.set.jump(1), { ok: false, code: 5, text: "the Remote Script is not running" });
});

test("fake api: pickRows records the list and answers the index; a disabled row is never chosen", async () => {
  const rows = [{ label: "a" }, { label: "b", detail: "x", disabled: true }];
  const fake = createFakeApi({ pickRowsAnswer: (_r, cursor) => (cursor === 1 ? 1 : 0) });
  assert.equal(await fake.api.pickRows("Stamps", rows), 0);
  assert.equal(await fake.api.pickRows("Stamps", rows, { cursor: 1 }), null);
  assert.deepEqual(fake.rowLists, [{ title: "Stamps", rows }, { title: "Stamps", rows, cursor: 1 }]);
  assert.equal(await createFakeApi().api.pickRows("t", rows), null);
});
