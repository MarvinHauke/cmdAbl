import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../shared/testPorts.js";
import { assertDocumented, declaredBy } from "../shared/docs.testkit.js";
import { validateTree } from "../../core/command/commandTree.js";
import { parse } from "../../core/command/parse.js";
import { activate } from "./index.js";

type Result = { code: number; message?: string; log?: string[] } | undefined;
const T = { playing: true, session: false, pos: "12.3.1.1", time: 46, barStart: 44, barLen: 4, sigNum: 4, sigDen: 4, songLength: 64, loop: { on: false, start: 0, length: 16 } };

function setup(transport: object | null = T) {
  const fake = createFakeApi({ transport: transport === null ? null : structuredClone(transport) } as never);
  activate(fake.api);
  const cmd = fake.commands[0] as unknown as { run: (i: never, p: never) => Promise<Result> };
  return { fake, run: (arg: string) => cmd.run({ path: ["jump"], options: {}, args: [[arg]] } as never, undefined as never) };
}

test("jump goes to the position", async () => {
  const s = setup();
  assert.equal((await s.run("12.3.1"))!.code, ExitCode.OK);
  assert.equal((await s.run("+2"))!.code, ExitCode.OK);
  assert.equal((await s.run("start"))!.code, ExitCode.OK);
  assert.equal((await s.run("end"))!.code, ExitCode.OK);
  assert.deepEqual(s.fake.jumps, [46, 52, 0, 64]);
});

test("bad input is exit 2, no script 5, Live's refusal 1; nothing jumps", async () => {
  const s = setup();
  assert.equal((await s.run("nope"))!.code, ExitCode.USAGE);
  assert.equal((await s.run("0"))!.code, ExitCode.USAGE);
  assert.deepEqual(s.fake.jumps, []);
  assert.equal((await setup(null).run("2"))!.code, ExitCode.UNAVAILABLE);
  assert.equal((await setup({ ...T, sigNum: 0, sigDen: 0 }).run("2.1.1"))!.code, ExitCode.UNAVAILABLE);
  s.fake.jumpFails = { code: 1, text: "Live refused the jump" };
  const r = (await s.run("3"))!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.match(r.message ?? "", /Live refused/);
});

test("the tree is valid and documented; the line parses", () => {
  const roots = declaredBy(activate);
  assert.deepEqual(validateTree(roots as never), []);
  assertDocumented(roots, ["jump"]);
  const o = parse("jump -4", roots);
  assert.equal(o.kind === "run" ? o.invocation.args[0]?.[0] : o.kind, "-4");
});
