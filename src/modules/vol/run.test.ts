import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { createFakeApi } from "../testPorts.js";
import { dbToValue, valueToDb } from "../mixValue.js";
import { activate } from "./index.js";

const track = (name: string, i: number, kind = "track") =>
  ({ name, path: `/${name}`, kind, scope: "regular", route: [i], handleId: name }) as unknown as ObjectNode;
const kick = track("Kick", 0);
const perc = track("Perc", 1);
const chain = track("Chain", 2, "chain");

type Result = { code: number; message?: string; log?: string[]; details?: Array<{ ok: boolean }> };
function setup(levels: Record<string, number> = {}) {
  const fake = createFakeApi({ nodes: [kick, perc] });
  for (const [name, db] of Object.entries(levels)) fake.volumes.set(name, dbToValue(db).value);
  activate(fake.api);
  const run = (text: string, targets: ObjectNode[], options: Record<string, string | true> = {}) =>
    fake.commands[0]!.run!({ path: ["vol"], options, args: [[text], targets] } as never, undefined as never) as Promise<Result>;
  const db = (n: ObjectNode) => valueToDb(fake.volumes.get(n.handleId) ?? 0.85);
  return { fake, run, db };
}

test("relative: every fader moves by the step, quietly, with old → new and an undo line in the log", async () => {
  const { run, db } = setup({ Kick: -6, Perc: -3 });
  const r = await run("-6", [kick, perc]);
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, undefined);
  assert.ok(Math.abs(db(kick) - -12) <= 0.1);
  assert.ok(Math.abs(db(perc) - -9) <= 0.1);
  assert.match(r.log!.join("\n"), /\/Kick: -6\.\d → -12\.\d dB\n {2}undo: vol --set -6\.\d \/Kick/);
});

test("decimal steps work: vol -1.5 and vol .5", async () => {
  const { run, db } = setup({ Kick: 0 });
  assert.equal((await run("-1.5", [kick])).code, ExitCode.OK);
  assert.ok(Math.abs(db(kick) - -1.5) <= 0.1);
  assert.equal((await run(".5", [kick])).code, ExitCode.OK);
  assert.ok(Math.abs(db(kick) - -1) <= 0.1);
});

test("--set is absolute, -inf allowed; the old level is in the undo line", async () => {
  const { run, db, fake } = setup({ Kick: -20 });
  const r = await run("-3.2", [kick, perc], { set: true });
  assert.ok(Math.abs(db(kick) - -3.2) <= 0.1 && Math.abs(db(perc) - -3.2) <= 0.1);
  assert.match(r.log!.join("\n"), /undo: vol --set -20\.0 \/Kick/);
  assert.equal((await run("-inf", [kick], { set: true })).code, ExitCode.OK);
  assert.equal(fake.volumes.get("Kick"), 0);
  assert.match((await run("0", [kick], { set: true })).log!.join("\n"), /\/Kick: -inf → 0\.0 dB\n {2}undo: vol --set -inf \/Kick/);
});

test("one transaction per run", async () => {
  const { run, fake } = setup();
  await run("-1", [kick, perc]);
  assert.equal(fake.transactions, 1);
});

test("a fader that hits a limit is named; nothing else is shown", async () => {
  const { run, fake } = setup({ Kick: 5, Perc: -60 });
  const r = await run("3", [kick, perc]);
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, "limit reached: /Kick at +6 dB (the maximum)");
  assert.equal(fake.volumes.get("Kick"), 1);
  const low = await run("-20", [perc]);
  assert.equal(low.message, "limit reached: /Perc at -inf");
  assert.equal(fake.volumes.get("Perc"), 0);
});

test("nothing moved says so", async () => {
  const { run } = setup();
  assert.equal((await run("0", [kick])).message, "nothing changed");
});

test("a bad number is exit 2 and writes nothing; a chain is refused with the tracks-only message", async () => {
  const { run, fake } = setup();
  const bad = await run("loud", [kick]);
  assert.equal(bad.code, ExitCode.USAGE);
  assert.match(bad.message ?? "", /"loud" is not a level in dB/);
  const c = await run("-3", [kick, chain]);
  assert.equal(c.code, ExitCode.USAGE);
  assert.match(c.message ?? "", /vol works on tracks for now, not on \/Chain/);
  assert.equal(fake.volumes.size, 0);
});

test("a fader that cannot be read or written fails that track and lists only the failures", async () => {
  const { run, fake } = setup({ Kick: -6, Perc: -6 });
  const setVolume = fake.api.tracks.setVolume;
  fake.api.tracks.setVolume = (n, v) => (n.name === "Perc" ? Promise.resolve(false) : setVolume(n, v));
  const r = await run("-1", [kick, perc]);
  assert.equal(r.code, ExitCode.FAILURE);
  assert.equal(r.message, "vol: 1 of 2 done");
  assert.deepEqual(r.details?.map((d) => d.ok), [false]);
  assert.match(r.log!.join("\n"), /\/Kick/);
});

test("the same track twice is changed once", async () => {
  const { run, db } = setup({ Kick: 0 });
  await run("-3", [kick, kick]);
  assert.ok(Math.abs(db(kick) - -3) <= 0.1);
});

test("the command has no digit as a short option (so -1 stays a number) and sits in Mix", () => {
  const { fake } = setup();
  const vol = fake.commands[0]!;
  assert.equal(vol.topic, "Mix");
  for (const o of vol.options ?? []) assert.doesNotMatch(o.short ?? "", /\d/);
});
