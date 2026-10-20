import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { fail as bridgeFail } from "../../ableton/bridgeProtocol.js";
import { ExitCode, type CommandResult } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";
import { splitPattern } from "./tagged.js";

const node = (handleId: string, kind: ObjectNode["kind"], route: number[], path: string, name: string, scope = "regular"): ObjectNode =>
  ({ handleId, kind, route, scope, name, path, children: [] }) as unknown as ObjectNode;
const drums = node("d", "track", [0], "/Drums", "Drums");
const kick = node("k", "chain", [0, 0], "/Drums/Kick", "Kick");
const lead = node("l", "track", [1], "/Lead", "Lead");
const bass = node("b", "track", [2], "/Bass", "Bass");
const kickBus = node("kb", "track", [3], "/Kick Bus", "Kick Bus");
const ret = node("r", "track", [0], "/A-Reverb", "A-Reverb", "return");
drums.children.push(kick);
const all = [drums, kick, lead, bass, kickBus, ret];
const tags = { d: ["drums"], kb: ["drums", "bus"], b: ["synth"] };

function setup(extra: Parameters<typeof createFakeApi>[0] = {}) {
  const fake = createFakeApi({ nodes: all, tags, bridge: { ops: { select: () => ({ ok: true as const, value: { name: "x" } }) } }, ...extra });
  const picked: string[][] = [];
  fake.api.pick = async (_t, candidates) => {
    picked.push(candidates.map((n) => n.path));
    return null;
  };
  activate(fake.api);
  const find = fake.commands.find((c) => c.name === "find")!;
  const run = async (pattern: string, options: Record<string, string | true> = {}) =>
    (await find.run!({ path: ["find"], options, args: [[pattern]] } as never, undefined as never)) as CommandResult | undefined;
  return { fake, run, picked };
}

test("splitPattern separates #tag and !#tag from plain words", () => {
  assert.deepEqual(splitPattern("#Drums kick !#fx # a#b"), {
    plain: ["kick", "#", "a#b"],
    tags: [{ name: "drums", negate: false }, { name: "fx", negate: true }],
  });
});

test("find #drums lists the tracks tagged drums (several: the pick list, tracks only)", async () => {
  const { run, picked } = setup();
  await run("#drums");
  assert.deepEqual(picked, [["/Drums", "/Kick Bus"]]);
});

test("find !#drums lists the regular tracks without the tag, never a return track", async () => {
  const { run, picked } = setup();
  await run("!#drums");
  assert.deepEqual(picked, [["/Lead", "/Bass"]]);
});

test("find drums = path matches plus tracks tagged drums, in tree order", async () => {
  const { run, picked } = setup();
  await run("drums");
  assert.deepEqual(picked, [["/Drums", "/Drums/Kick", "/Kick Bus"]]); // /Drums by path and tag, the chain by path, Kick Bus by tag
});

test("find #drums kick searches inside the tagged tracks only", async () => {
  const { run, picked, fake } = setup();
  const r = await run("#drums kick");
  assert.equal(r?.code ?? 0, ExitCode.OK);
  // /Drums/Kick (inside Drums) and /Kick Bus (tagged drums, "kick" in its path): two hits
  assert.deepEqual(picked, [["/Drums/Kick", "/Kick Bus"]]);
  assert.equal(fake.bridge.calls.length, 0);
  const lead = await run("#synth kick"); // Bass is tagged synth, but nothing of it contains kick
  assert.equal(lead?.message, 'find: nothing matches "#synth kick"');
});

test("find #drums -c lists the chains inside tagged tracks; -t keeps the tracks", async () => {
  const { run, fake } = setup();
  await run("#drums", { chains: true });
  assert.deepEqual(fake.bridge.calls.map((c) => c.args.route), [[0, 0]]);
  const t = setup();
  await t.run("#drums", { tracks: true });
  assert.deepEqual(t.picked, [["/Drums", "/Kick Bus"]]);
});

test("no track with the tag is exit 3 with the tag in the message", async () => {
  const { run } = setup();
  const r = await run("#nope");
  assert.equal(r?.code, ExitCode.NOT_FOUND);
  assert.equal(r?.message, "find: no track is tagged #nope");
  // a tag nobody carries is "not tagged" even when negated — never every track
  const negated = await run("!#nope");
  assert.equal(negated?.code, ExitCode.NOT_FOUND);
  assert.equal(negated?.message, "find: no track is tagged #nope");
  assert.equal((await run("!#drums #nope"))?.message, "find: no track is tagged #nope");
  // known tags that leave no track: the combination message
  assert.equal((await run("!#drums !#synth !#bus"))?.code, ExitCode.OK); // Lead has none of them
  assert.equal((await run("#drums #synth"))?.message, "find: no track is tagged #drums #synth");
  assert.equal((await setup({ tags: { l: ["a"], b: ["a"], d: ["a"], kb: ["a"] } }).run("!#a"))?.message, "find: no track without #a");
});

test("script down: #tag is exit 5; plain words still work", async () => {
  const fake = createFakeApi({ nodes: all, tags, bridge: { ops: { select: () => ({ ok: true as const, value: { name: "x" } }) } } });
  fake.api.tags.refresh = async () => bridgeFail(5, "Remote Script not running");
  activate(fake.api);
  const find = fake.commands.find((c) => c.name === "find")!;
  const r = (await find.run!({ path: ["find"], options: {}, args: [["#drums"]] } as never, undefined as never)) as CommandResult;
  assert.equal(r.code, ExitCode.UNAVAILABLE);
  fake.api.pick = async () => null;
  const plain = (await find.run!({ path: ["find"], options: {}, args: [["lead"]] } as never, undefined as never)) as CommandResult | undefined;
  assert.equal(plain?.code ?? ExitCode.OK, ExitCode.OK);
});
