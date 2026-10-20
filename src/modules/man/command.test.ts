import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTree } from "../../core/commandTree.js";
import { parse } from "../../core/parse.js";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

function setup() {
  const fake = createFakeApi({});
  fake.api.commands.add({
    name: "history",
    summary: "the command history",
    children: [{ name: "clear", summary: "empty it", examples: [{ line: "history clear" }], run: () => undefined }],
  });
  activate(fake.api);
  const man = fake.commands.find((c) => c.name === "man")!;
  const run = async (line: string) => {
    const outcome = parse(line, fake.commands);
    assert.equal(outcome.kind, "run", line);
    if (outcome.kind !== "run") throw new Error(line);
    return (await man.run!(outcome.invocation, undefined as never)) as { code: number; message?: string };
  };
  return { fake, man, run };
}

test("man declares one required variadic argument", () => {
  const { man } = setup();
  assert.deepEqual(validateTree([man]), []);
  assert.equal(man.args?.[0]?.variadic, true);
  assert.notEqual(man.args?.[0]?.required, false);
});

test("man <command> shows the page of a command and of a subcommand", async () => {
  const { run } = setup();
  const group = await run("man history");
  assert.equal(group.code, ExitCode.OK);
  assert.match(group.message ?? "", /usage: history/);
  assert.match(group.message ?? "", /web: https:\/\/marvinhauke\.github\.io\/cmdAbl\/reference\/commands\/#history$/);
  const sub = await run("man history clear");
  assert.match(sub.message ?? "", /usage: history clear/);
  assert.match(sub.message ?? "", /#history-clear$/);
});

test("an unknown command is exit 3 with close matches", async () => {
  const { run } = setup();
  const r = await run("man histroy");
  assert.equal(r.code, ExitCode.NOT_FOUND);
  assert.match(r.message ?? "", /Did you mean: history/);
  const far = await run("man zzzzzz");
  assert.equal(far.code, ExitCode.NOT_FOUND);
  assert.doesNotMatch(far.message ?? "", /Did you mean/);
});

test("a bare man is a usage error", () => {
  const { man } = setup();
  assert.equal(parse("man", [man]).kind, "error");
});

test("a quoted name stays one word", async () => {
  const { run } = setup();
  const r = await run('man "history clear"');
  assert.equal(r.code, ExitCode.NOT_FOUND);
  assert.match(r.message ?? "", /Did you mean: history clear/);
});
