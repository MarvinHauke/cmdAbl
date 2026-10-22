import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { createFakeApi } from "../testPorts.js";
import { dbToValue, valueToDb } from "../mixValue.js";
import { parse } from "../../core/parse.js";
import { activate } from "./index.js";

const track = (name: string, i: number, kind = "track") =>
  ({ name, path: `/${name}`, kind, scope: "regular", route: [i], handleId: name }) as unknown as ObjectNode;
const kick = track("Kick", 0);
const perc = track("Perc", 1);
const chain = track("Chain", 2, "chain");

type Result = { code: number; message?: string; log?: string[]; details?: Array<{ ok: boolean }> };
function setup(levels: Record<string, number> = {}, confirmAnswer = false) {
  const fake = createFakeApi({ nodes: [kick, perc], confirmAnswer });
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

test("stop (default): a step that would pass +6 dB is shortened for every fader; the balance stays", async () => {
  const { run, db, fake } = setup({ Kick: 3, Perc: -3 });
  const r = await run("9", [kick, perc]);
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, "vol 9: moved +3.0 dB, /Kick reached +6 dB (the maximum)");
  assert.ok(Math.abs(db(kick) - 6) <= 0.1);
  assert.ok(Math.abs(db(perc) - 0) <= 0.1);
  assert.equal(fake.confirms.length, 0);
  assert.equal(fake.transactions, 1);
  assert.match(r.log![0]!, /^vol 9: asked \+9\.0 dB, applied \+3\.0 dB$/);
});

test("stop downward: the floor is the lowest level, not -inf", async () => {
  const { run, fake } = setup({ Perc: -65, Kick: -20 });
  const r = await run("-30", [perc, kick]);
  assert.match(r.message ?? "", /^vol -30: moved -4\.\d dB, \/Perc reached -69\.6 dB \(the lowest step\)$/);
  assert.ok(fake.volumes.get("Perc")! > 0);
});

test("stop: a step shortened to nothing says nothing changed and names the fader at the end", async () => {
  const { run, fake } = setup({ Kick: 6, Perc: 0 });
  const before = new Map(fake.volumes);
  const r = await run("3", [kick, perc]);
  assert.equal(r.message, "nothing changed: /Kick is at +6 dB (the maximum)");
  assert.deepEqual(fake.volumes, before);
  assert.equal(fake.transactions, 0);
});

test("stop: a step of less than half a display step counts as nothing; at the floor the way out is named", async () => {
  const { run, fake } = setup({ Kick: 5.97 });
  assert.equal((await run("9", [kick])).message, "nothing changed: /Kick is at +6 dB (the maximum)");
  const floor = setup({ Perc: -69.6 });
  const r = await floor.run("-3", [perc]);
  assert.equal(r.message, "nothing changed: /Perc is at -69.6 dB (the lowest step) — use --clip or --set -inf to go lower");
  assert.equal(fake.confirms.length, 0);
});

test("stop: a fader at -inf stays, does not block the others, and is not mentioned", async () => {
  const { run, db, fake } = setup({ Perc: -6 });
  fake.volumes.set("Kick", 0);
  const r = await run("4", [kick, perc]);
  assert.equal(r.message, undefined);
  assert.equal(fake.volumes.get("Kick"), 0);
  assert.ok(Math.abs(db(perc) - -2) <= 0.1);
  const only = await run("4", [kick]);
  assert.equal(only.message, "nothing changed: /Kick is at -inf");
});

test("--clip: every fader follows the step, the ones past an end stop there and are named", async () => {
  const { run, db, fake } = setup({ Kick: 5, Perc: -60 });
  const r = await run("3", [kick, perc], { clip: true });
  assert.equal(r.message, "limit reached: /Kick at +6 dB (the maximum)");
  assert.equal(fake.volumes.get("Kick"), 1);
  assert.ok(Math.abs(db(perc) - -57) <= 0.1);
  const low = await run("-20", [perc], { clip: true });
  assert.equal(low.message, "limit reached: /Perc at -inf");
  assert.equal(fake.volumes.get("Perc"), 0);
});

test("--set never shortens and never asks; a level past an end is named", async () => {
  const { run, fake } = setup({ Kick: 5 });
  assert.equal((await run("20", [kick], { set: true })).message, "limit reached: /Kick at +6 dB (the maximum)");
  assert.equal((await run("-inf", [kick], { set: true })).code, ExitCode.OK);
  assert.equal(fake.volumes.get("Kick"), 0);
  assert.equal(fake.confirms.length, 0);
});

test("--clip with --set, and a relative step of -inf, are usage errors", async () => {
  const { run, fake } = setup();
  assert.equal((await run("-3", [kick], { set: true, clip: true })).code, ExitCode.USAGE);
  const inf = await run("-inf", [kick]);
  assert.equal(inf.code, ExitCode.USAGE);
  assert.match(inf.message ?? "", /use vol --set -inf/);
  assert.equal(fake.volumes.size, 0);
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

test("the command has no digit as a short option (so -1 stays a number), -c is --clip, and it sits in Mix", () => {
  const { fake } = setup();
  const vol = fake.commands[0]!;
  assert.equal(vol.topic, "Mix");
  for (const o of vol.options ?? []) assert.doesNotMatch(o.short ?? "", /\d/);
  assert.deepEqual((vol.options ?? []).map((o) => [o.name, o.short]), [["set", "s"], ["clip", "c"]]);
});

test("the line parses as intended: vol -1.5 /x, vol -c -3 #x, vol --set -inf /x", () => {
  const { fake } = setup();
  const args = (line: string) => {
    const r = parse(line, fake.commands);
    assert.equal(r.kind, "run", line);
    return r.kind === "run" ? { options: r.invocation.options, args: r.invocation.args } : undefined;
  };
  assert.deepEqual(args("vol -1.5 /x"), { options: {}, args: [["-1.5"], ["/x"]] });
  assert.deepEqual(args("vol -c -3 #x"), { options: { clip: true }, args: [["-3"], ["#x"]] });
  assert.deepEqual(args("vol --set -inf /x"), { options: { set: true }, args: [["-inf"], ["/x"]] });
  assert.deepEqual(args("vol +2 /x /y"), { options: {}, args: [["+2"], ["/x", "/y"]] });
});
