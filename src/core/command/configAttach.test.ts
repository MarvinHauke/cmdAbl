import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry, type Command } from "./commandRegistry.js";
import { attachConfigs } from "./configAttach.js";
import { runLine } from "./run.js";
import { ExitCode, ok } from "../types.js";

const make = (name: string): Command => ({ name: "config", summary: `settings of ${name}`, run: () => ok(`opened ${name}`) });
const run = (registry: CommandRegistry, line: string) => runLine(line, { registry, liveNodes: () => [], pick: async () => null });

function build() {
  const registry = new CommandRegistry();
  registry.add({ name: "man", summary: "manual", args: [{ name: "topic", kind: "text", required: false }], run: (inv) => ok(`man ${inv.args[0]?.[0] ?? ""}`.trim()) });
  registry.add({ name: "help", summary: "help", run: () => ok("help ran") });
  registry.add({ name: "tag", summary: "tag", args: [{ name: "t", kind: "text", required: false }], run: () => ok("tag ran") });
  return registry;
}

test("man and help get no platform config: the word is looked up as before", async () => {
  const registry = build();
  const warns: string[] = [];
  attachConfigs(registry, { make, groups: () => [], warn: (t) => warns.push(t) });
  assert.equal((await run(registry, "man config")).result.message, "man config");
  assert.equal((await run(registry, "help config")).result.code, ExitCode.USAGE);
  assert.equal((await run(registry, "tag config")).result.message, "opened tag");
  assert.deepEqual(warns, []);
});

test("a declared group with no command of its name is warned about; one whose command has its own config too", () => {
  const registry = build();
  registry.add({ name: "own", summary: "o", children: [{ name: "config", summary: "mine", run: () => ok("x") }] });
  const warns: string[] = [];
  attachConfigs(registry, { make, groups: () => ["tag", "ghost", "own"], warn: (t) => warns.push(t) });
  assert.equal(warns.length, 2);
  assert.match(warns.join("\n"), /group "ghost" has no command/);
  assert.match(warns.join("\n"), /group "own" could not get/);
});
