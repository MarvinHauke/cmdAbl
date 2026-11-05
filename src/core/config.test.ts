import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry, type Command } from "./commandRegistry.js";
import { registerBuiltins } from "./builtins.js";
import { parse } from "./parse.js";
import { runLine, type RunDeps } from "./run.js";
import { helpText, serializeTree, shortHelpText, validateTree } from "./commandTree.js";
import { createSettingsFlow } from "./settingsSurface.js";
import { createSettingsRegistry, createSettingsStore } from "./settings.js";
import { ExitCode, ok } from "./types.js";
import { complete } from "./complete.js";
import { completionTree } from "./commandTree.js";

// `<command> config` and `cmdabl config` (plan 0019 §2).

const opened: Array<{ group?: string; only?: boolean }> = [];
const config = (group: string): Command => ({ name: "config", summary: `open the settings of ${group}`, run: () => (opened.push({ group, only: true }), ok(`opened ${group}`)) });

function build() {
  opened.length = 0;
  const registry = new CommandRegistry();
  // a runnable command with arguments (like tag, mute), a group with a fallback (like map), and one that already has its own `config` child
  registry.add({ name: "tag", summary: "tag tracks", args: [{ name: "target", kind: "text", required: false }], run: () => ok("tag ran") });
  registry.add({
    name: "map",
    summary: "map midi",
    children: [
      { name: "learn", summary: "learn", run: () => ok("learn ran") },
      { name: "add", summary: "add", fallback: true, args: [{ name: "x", kind: "text", required: false }], run: (inv) => ok(`add ${inv.args[0]?.[0] ?? ""}`.trim()) },
    ],
  });
  registry.add({ name: "own", summary: "has its own", children: [{ name: "config", summary: "my own config", run: () => ok("own config ran") }] });
  registry.add({ name: "plain", summary: "no settings", args: [{ name: "target", kind: "text", required: false }], run: () => ok("plain ran") });
  for (const name of ["tag", "map"]) assert.equal(registry.attachConfig(name, config(name)), true);
  return registry;
}

const run = (registry: CommandRegistry, line: string) => runLine(line, { registry, liveNodes: () => [], pick: async () => null } satisfies RunDeps);

test("`<command> config` opens that command's settings: on a runnable command, on a group with a fallback", async () => {
  const registry = build();
  assert.equal((await run(registry, "tag config")).result.message, "opened tag");
  assert.equal((await run(registry, "map config")).result.message, "opened map");
  assert.deepEqual(opened, [{ group: "tag", only: true }, { group: "map", only: true }]);
});

test("`config` is only a word right after the command: elsewhere, quoted, or with more words it stays what it was", async () => {
  const registry = build();
  assert.equal((await run(registry, 'tag "config"')).result.message, "tag ran"); // quoted: a target
  const second = await run(registry, "tag x config");
  assert.equal(second.result.code, ExitCode.USAGE); // `config` here is a second argument, not the settings
  assert.match(second.result.message!, /unexpected argument "config"/);
  assert.equal(opened.length, 0);
  const extra = await run(registry, "tag config now");
  assert.equal(extra.result.code, ExitCode.USAGE);
  assert.match(extra.result.message!, /unexpected argument "now"/);
  assert.equal((await run(registry, "map config | mute")).result.code, ExitCode.USAGE); // a pipe is for commands that take a line
  assert.equal((await run(registry, "plain config")).result.message, "plain ran"); // no settings: `config` is just text
  assert.equal((await run(registry, "own config")).result.message, "own config ran"); // a real subcommand wins
});

test("attachConfig refuses an unknown command, a node with arguments or children, and a command with its own `config`", () => {
  const registry = build();
  assert.equal(registry.attachConfig("nope", config("nope")), false);
  assert.equal(registry.attachConfig("plain", { name: "config", summary: "s", args: [{ name: "a", kind: "text" }], run: () => {} }), false);
  assert.equal(registry.attachConfig("plain", { name: "config", summary: "s", children: [{ name: "x", summary: "x", run: () => {} }] }), false);
  assert.equal(registry.attachConfig("own", config("own")), false);
  assert.equal(registry.attachConfig("plain", { name: "config", summary: "s" }), false); // no run
  assert.deepEqual(validateTree(registry.roots()), []);
});

test("--help and man list the config subcommand; the serialized tree for the palette has no function in it", () => {
  const registry = build();
  const tag = registry.roots().find((n) => n.name === "tag")!;
  assert.match(shortHelpText(tag, ["tag"]), /settings:\n  tag config\s+open the settings of tag/);
  assert.match(helpText(tag, ["tag"]), /settings:\n  tag config/);
  assert.doesNotMatch(helpText(registry.roots().find((n) => n.name === "plain")!, ["plain"]), /settings:/);
  const serialized = serializeTree(registry.roots());
  assert.equal(JSON.stringify(serialized.filter((n) => n.name !== "own")).includes("config"), false);
  assert.equal("config" in serialized[0]!, false);
  assert.equal(JSON.stringify(completionTree(registry.roots())).includes("function"), false);
  assert.deepEqual(parse("tag config", registry.roots()).kind, "run");
});

test("`cmdabl config [<group>]` opens the page, completes the group ids, and an unknown group is exit 3", async () => {
  const registry = new CommandRegistry();
  const settings = createSettingsRegistry();
  settings.declare("tag", { heading: "Tags", items: [{ key: "tag.foldAfter", label: "Fold", help: "h", kind: "int", default: 20, min: 1, max: 500 }] });
  const requests: string[] = [];
  const flow = createSettingsFlow({
    registry: settings,
    store: createSettingsStore({ base: "/nonexistent/cmdabl-test", registry: settings, warn: () => {} }),
    ui: { settings: async (request) => (requests.push(`${request.title}|${request.focus ?? ""}|${request.groups.length}`), null) },
  });
  registerBuiltins(registry, { settings: flow });
  assert.deepEqual((await run(registry, "cmdabl config")).result, { code: 0 });
  assert.deepEqual((await run(registry, "cmdabl config tag")).result, { code: 0 });
  assert.deepEqual(requests, ["cmdAbl Settings||4", "cmdAbl Settings|tag|4"]);
  const missing = await run(registry, "cmdabl config nope");
  assert.equal(missing.result.code, ExitCode.NOT_FOUND);
  // the completer behind <group>: core's group ids first, then the modules', then `defaults` (the default commands page)
  const rows = await registry.completers().get("settings-groups")!({ tokens: [], text: "" } as never);
  assert.deepEqual((rows as Array<{ label: string }>).map((r) => r.label), ["cmdabl", "map", "midi", "tag", "defaults"]);
  assert.deepEqual(registry.unknownCompleters(), []);
  // without a settings port the command answers exit 5
  const bare = new CommandRegistry();
  registerBuiltins(bare);
  assert.equal((await run(bare, "cmdabl config")).result.code, ExitCode.UNAVAILABLE);
});

test("the palette offers `config` as the first word after a command with settings (leaf and group), and nowhere else", () => {
  const registry = build();
  const data = { tree: completionTree(registry.roots()), completions: {}, paths: [], tags: [] };
  const labels = (line: string) => complete(line, line.length, data).items.filter((i) => i.kind === "command").map((i) => i.label);
  assert.deepEqual(labels("tag "), ["config"]); // leaf: beside its arguments
  assert.deepEqual(labels("tag co"), ["config"]);
  assert.deepEqual(labels("tag x "), []); // not the first word
  assert.deepEqual(labels("plain "), []); // no settings
  assert.deepEqual(labels("map "), ["learn", "add", "config"]); // group: one more subcommand
  assert.deepEqual(labels("tag -"), []);
  assert.equal(complete("tag ", 4, data).items.find((i) => i.label === "config")?.description, "open the settings of tag");
});

test("help and usage resolve `<command> config` through the registry's roots (what man reads)", async () => {
  const { helpForPath, usageForPath } = await import("./commandTree.js");
  const registry = build();
  for (const name of ["tag", "map"]) {
    assert.match(helpForPath(registry.roots(), [name, "config"])!, /open the settings of/);
    assert.match(usageForPath(registry.roots(), [name, "config"])!, /config/);
  }
  assert.equal(helpForPath(registry.roots(), ["plain", "config"]), undefined);
  assert.equal(helpForPath(registry.roots(), ["tag", "config", "x"]), undefined);
});
