import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../shared/testPorts.js";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { validateTree } from "../../core/command/commandTree.js";
import { parse } from "../../core/command/parse.js";
import { activate } from "./index.js";

type Result = { code: number; message?: string; log?: string[] } | undefined;
const PLAYING = { playing: true, session: false, pos: "12.3.1.1", time: 44, barStart: 44, barLen: 4, sigNum: 4, sigDen: 4, songLength: 200, loop: { on: false, start: 0, length: 16 } };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function setup(transport: object | null = PLAYING, settings: Record<string, unknown> = {}) {
  const fake = createFakeApi({ transport: transport === null ? null : clone(transport as never), settings } as never);
  activate(fake.api);
  const root = fake.commands[0] as unknown as { children: Array<{ name: string; run: (i: never, p: never) => Promise<Result> }> };
  const run = (name: string, ...args: string[]) =>
    root.children.find((c) => c.name === name)!.run({ path: ["loop", name], options: {}, args: args.length ? [args] : [] } as never, undefined as never) as Promise<Result>;
  return { fake, run };
}

test("loop here sets and switches on; loop back restores", async () => {
  const s = setup();
  assert.equal((await s.run("here"))!.code, ExitCode.OK);
  assert.deepEqual(s.fake.transport!.loop, { on: true, start: 44, length: 16 });
  assert.equal((await s.run("back"))!.code, ExitCode.OK);
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});

test("bars: argument, setting loop.bars, bad value is usage", async () => {
  const s = setup(PLAYING, { "loop.bars": 8 });
  await s.run("here");
  assert.equal(s.fake.transport!.loop.length, 32);
  await s.run("here", "2");
  assert.equal(s.fake.transport!.loop.length, 8);
  for (const bad of ["0", "65", "x", "2.5"]) assert.equal((await s.run("here", bad))!.code, ExitCode.USAGE);
});

test("a second loop here keeps the first old loop", async () => {
  const s = setup();
  await s.run("here", "4");
  await s.run("here", "2");
  await s.run("back");
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});

test("loop back leaves a loop that was moved, and has nothing to do without a loop here", async () => {
  const s = setup();
  assert.match((await s.run("back"))!.log![0]!, /nothing to restore/);
  await s.run("here");
  s.fake.transport!.loop = { on: true, start: 100, length: 8 };
  assert.match((await s.run("back"))!.log![0]!, /left alone/);
  assert.deepEqual(s.fake.transport!.loop, { on: true, start: 100, length: 8 });
  assert.match((await s.run("back"))!.log![0]!, /nothing to restore/);
});

test("on / off set the flag and keep the position; repeating is quiet", async () => {
  const s = setup();
  await s.run("on");
  assert.deepEqual(s.fake.transport!.loop, { on: true, start: 0, length: 16 });
  assert.match((await s.run("on"))!.log![0]!, /already on/);
  await s.run("off");
  assert.equal(s.fake.transport!.loop.on, false);
});

test("show reports the loop; nothing runs without the Remote Script (exit 5)", async () => {
  const s = setup();
  const r = (await s.run("show"))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, "loop off: from bar 1, 4 bars");
  const none = setup(null);
  for (const n of ["show", "here", "on", "off"]) assert.equal((await none.run(n))!.code, ExitCode.UNAVAILABLE, n);
  const failing = setup();
  failing.fake.api.set.setLoop = async () => ({ ok: false, code: 5, text: "no script" });
  for (const n of ["here", "on"]) assert.equal((await failing.run(n))!.code, ExitCode.UNAVAILABLE, n);
});

test("a failed restore is exit 5 with a warning", async () => {
  const s = setup();
  await s.run("here");
  s.fake.api.set.setLoop = async () => ({ ok: false, code: 5, text: "no script" });
  assert.equal((await s.run("back"))!.code, ExitCode.UNAVAILABLE);
  assert.ok(s.fake.logged.some((l) => l.level === "warn" && /not restored/.test(l.text)));
});

test("loop back when Live refuses the old loop: exit 1 with Live's reason", async () => {
  const s = setup();
  await s.run("here");
  s.fake.api.set.setLoop = async () => ({ ok: false, code: 1, text: "Live said no" });
  const r = (await s.run("back"))!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.match(r.message ?? "", /Live said no/);
  // the old loop is still remembered: a second try works once Live accepts
  s.fake.api.set.setLoop = async (l) => ({ ok: true, loop: l });
  assert.equal((await s.run("back"))!.code, ExitCode.OK);
});

test("a refused loop here shows Live's text with exit 1", async () => {
  const s = setup();
  s.fake.api.set.setLoop = async () => ({ ok: false, code: 1, text: "Cannot set the Loopstart" });
  const r = (await s.run("here"))!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.match(r.message ?? "", /Cannot set the Loopstart/);
});

test("loop declares loop.bars; the tree is valid and documented; bare loop runs show", () => {
  const s = setup();
  assert.deepEqual(s.fake.settingGroups.flatMap((g) => g.items).map((i) => [i.key, i.kind, i.default]), [["loop.bars", "int", 4]]);
  const roots = declaredBy(activate);
  assert.deepEqual(validateTree(roots as never), []);
  assertDocumented(roots, ["loop show", "loop here", "loop on", "loop off", "loop back"]);
  const ran = (line: string) => {
    const o = parse(line, roots);
    return o.kind === "run" ? [o.invocation.path.join(" "), o.invocation.args] : o.kind;
  };
  assert.deepEqual(ran("loop"), ["loop", []]);
  assert.deepEqual(ran("loop here 8"), ["loop here", [["8"]]]);
  assert.deepEqual(ran("loop back"), ["loop back", []]);
});

test("loop back without the Remote Script is exit 5 and keeps the remembered loop", async () => {
  const s = setup();
  await s.run("here");
  const saved = s.fake.transport;
  s.fake.transport = null as never;
  assert.equal((await s.run("back"))!.code, ExitCode.UNAVAILABLE);
  s.fake.transport = saved;
  assert.equal((await s.run("back"))!.code, ExitCode.OK);
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});
