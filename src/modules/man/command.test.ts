import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command } from "../../commandRegistry.js";
import { validateTree } from "../../core/commandTree.js";
import { parse } from "../../core/parse.js";
import { ExitCode } from "../../types.js";
import type { ModuleApi } from "../types.js";
import { activate } from "./index.js";

const added: Command[] = [];
activate({ commands: { add: (c: Command) => added.push(c) } } as unknown as ModuleApi);
const man = added[0]!;

test("man declares an enum topic followed by free words", () => {
  assert.deepEqual(validateTree([man]), []);
  assert.equal(man.args?.[0]?.kind, "enum");
  assert.deepEqual(man.args?.[0]?.choices, ["ableton", "cmdabl"]);
  assert.equal(man.args?.[1]?.rest, true);
});

test("man <topic> and man <topic> <words> parse; the words stay one value", () => {
  const bare = parse("man ableton", [man]);
  assert.equal(bare.kind, "run");
  const searched = parse("man ABLETON warp modes", [man]);
  assert.equal(searched.kind, "run");
  if (searched.kind === "run") {
    assert.equal(searched.invocation.args[0]![0], "ableton"); // the declared spelling
    assert.deepEqual(searched.invocation.args[1], ["warp modes"]);
  }
});

test("a bare man and an unknown topic are usage errors that list the choices", () => {
  for (const line of ["man", "man nope"]) {
    const outcome = parse(line, [man]);
    assert.equal(outcome.kind, "error", line);
    if (outcome.kind === "error") {
      assert.equal(outcome.result.code, ExitCode.USAGE);
      assert.match(outcome.result.message ?? "", /ableton/);
    }
  }
});
