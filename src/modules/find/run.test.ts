import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ExitCode, type CommandResult } from "../../core/types.js";
import { createFakeApi } from "../shared/testPorts.js";
import { activate } from "./index.js";

const node = (handleId: string, kind: ObjectNode["kind"], route: number[], path: string, name: string): ObjectNode =>
  ({ handleId, kind, route, scope: "regular", name, path, children: [] }) as ObjectNode;
const nodes = [
  node("1", "track", [0], "/Vermona MIDI", "Vermona MIDI"),
  node("2", "device", [0, 0], "/Vermona MIDI/Drum Rack", "Drum Rack"),
  node("3", "chain", [0, 0, 0], "/Vermona MIDI/Drum Rack/Kick", "Kick"),
  node("4", "chain", [0, 0, 1], "/Vermona MIDI/Drum Rack/Snare", "Snare"),
  node("5", "track", [1], "/Kick Bus", "Kick Bus"),
];
// the flattened list keeps the parent/children relation, like the real tree
nodes[1]!.children.push(nodes[2]!, nodes[3]!);
nodes[0]!.children.push(nodes[1]!);
const selectOk = (args: Record<string, unknown>) => ({
  ok: true as const,
  value: { name: String(args.expectName) },
});

function setup() {
  const fake = createFakeApi({ nodes, bridge: { ops: { select: selectOk } } });
  const answer = (choose: (c: ObjectNode[]) => ObjectNode[] | null) => {
    fake.api.pick = async (_title, candidates) => choose(candidates);
  };
  activate(fake.api);
  // "find" runs the fallback child `search`; "next"/"prev" are subcommands of find.
  const cmd = (name: string) => {
    const group = fake.commands.find((c) => c.name === "find")!;
    return group.children!.find((c) => (name === "find" ? c.fallback : c.name === name))!;
  };
  const run = async (name: string, options: Record<string, string | true>, pattern?: string) =>
    (await cmd(name).run!(
      { path: name === "find" ? ["find"] : ["find", name], options, args: pattern === undefined ? [] : [[pattern]] } as never,
      undefined as never,
    )) as CommandResult | void;
  return { fake, run, answer };
}
const code = (r: CommandResult | void) => r?.code ?? ExitCode.OK;

test("find: one hit is selected directly", async () => {
  const { fake, run } = setup();
  assert.equal(code(await run("find", {}, "snare")), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls.map((c) => c.args.route), [[0, 0, 1]]);
});

test("find: nothing matches is exit 3 and nothing is selected", async () => {
  const { fake, run } = setup();
  assert.equal(code(await run("find", {}, "nope")), ExitCode.NOT_FOUND);
  assert.equal(fake.bridge.calls.length, 0);
});

test("find: -c limits the search to chains; several hits go to the pick list", async () => {
  const { fake, run, answer } = setup();
  const asked: string[][] = [];
  answer((candidates) => {
    asked.push(candidates.map((n) => n.path));
    return [candidates[1]!];
  });
  // "kick" hits the pad and the track "Kick Bus"; with -c only the pad
  assert.equal(code(await run("find", { chains: true }, "kick")), ExitCode.OK);
  assert.equal(asked.length, 0);
  assert.deepEqual(fake.bridge.calls.map((c) => c.args.route), [[0, 0, 0]]);
  // without a flag: pad and track → pick list
  assert.equal(code(await run("find", {}, "kick")), ExitCode.OK);
  assert.deepEqual(asked[0], ["/Vermona MIDI/Drum Rack/Kick", "/Kick Bus"]);
  assert.deepEqual(fake.bridge.calls[1]!.args.route, [1]);
});

test("next/prev step through the last find's list and keep --unfold", async () => {
  const { fake, run, answer } = setup();
  answer((candidates) => [candidates[0]!]);
  await run("find", { unfold: true }, "kick"); // two hits → pick → first chosen (position 1)
  assert.equal(fake.bridge.calls[0]!.args.showChains, true);
  assert.equal(code(await run("next", {})), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[1]!.args.route, [1]);
  assert.equal(fake.bridge.calls[1]!.args.showChains, true);
  assert.equal(code(await run("prev", {})), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[2]!.args.route, [0, 0, 0]);
});

test("next without an earlier find is exit 3", async () => {
  const { run } = setup();
  assert.equal(code(await run("next", {})), ExitCode.NOT_FOUND);
});

test("next: a remembered object that is gone is \"no longer there\", never a neighbour whose path contains it", async () => {
  const { fake, run } = setup();
  // one hit remembered: /Kick Bus (the only match of "bus")
  assert.equal(code(await run("find", {}, "bus")), ExitCode.OK);
  fake.api.liveSet.nodes = () => [node("9", "track", [0], "/Kick Bus 2", "Kick Bus 2")];
  const result = (await run("next", {})) as CommandResult;
  assert.equal(result.code, ExitCode.NOT_FOUND);
  assert.match(result.message ?? "", /no longer there/);
  assert.equal(fake.bridge.calls.length, 1); // only the find's own select
});

test("find is a search: a word naming only a parent lists the parent and everything below it", async () => {
  const { fake, run, answer } = setup();
  const offered: string[][] = [];
  answer((candidates) => {
    offered.push(candidates.map((n) => n.path));
    return [candidates[0]!];
  });
  assert.equal(code(await run("find", {}, "vermona")), ExitCode.OK);
  assert.deepEqual(offered[0], [
    "/Vermona MIDI",
    "/Vermona MIDI/Drum Rack",
    "/Vermona MIDI/Drum Rack/Kick",
    "/Vermona MIDI/Drum Rack/Snare",
  ]);
  assert.equal(fake.bridge.calls.length, 1);
});

// ── -L and the pattern-less forms ───────────────────────────────────────────

test("find: -L is a whole number 0..12 (the platform rejects the rest with exit 2)", async () => {
  const { fake } = setup();
  const { parse } = await import("../../core/command/parse.js");
  for (const line of ["find kick -L 0", "find -L 12 kick", "find --level=3 kick", "find -t", "find -L 1"]) {
    assert.equal(parse(line, fake.commands).kind, "run", line);
  }
  for (const line of ["find kick -L 13", "find kick -L -1", "find kick -L 1.5", "find kick -L two"]) {
    const outcome = parse(line, fake.commands);
    assert.equal(outcome.kind, "error", line);
    if (outcome.kind === "error") assert.equal(outcome.result.code, ExitCode.USAGE, line);
  }
});

test("find -L 0 lists only objects with the word in their own name", async () => {
  const { fake, run, answer } = setup();
  const offered: string[][] = [];
  answer((c) => {
    offered.push(c.map((n) => n.path));
    return [c[0]!];
  });
  assert.equal(code(await run("find", { level: "0" }, "vermona")), ExitCode.OK);
  assert.equal(offered.length, 0); // one hit: selected directly
  assert.deepEqual(fake.bridge.calls.map((c) => c.args.route), [[0]]);
  assert.equal(code(await run("find", { level: "1" }, "vermona")), ExitCode.OK);
  assert.deepEqual(offered[0], ["/Vermona MIDI", "/Vermona MIDI/Drum Rack"]);
});

test("find without a pattern: a bare find is a usage error; -t and -L list from the top", async () => {
  const { fake, run, answer } = setup();
  assert.equal(code(await run("find", {})), ExitCode.USAGE);
  const offered: string[][] = [];
  answer((c) => {
    offered.push(c.map((n) => n.path));
    return [c[0]!];
  });
  assert.equal(code(await run("find", { tracks: true })), ExitCode.OK);
  assert.deepEqual(offered[0], ["/Vermona MIDI", "/Kick Bus"]);
  assert.equal(code(await run("find", { level: "1" })), ExitCode.OK);
  assert.deepEqual(offered[1], ["/Vermona MIDI", "/Kick Bus"]);
  assert.equal(code(await run("find", { level: "0" })), ExitCode.USAGE); // 0 levels below the Set is nothing
  assert.equal(fake.bridge.calls.length, 2);
});

test("find -L 2 -c kick: a kind flag combines with -L", async () => {
  const { fake, run } = setup();
  assert.equal(code(await run("find", { level: "2", chains: true }, "kick")), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls.map((c) => c.args.route), [[0, 0, 0]]);
});

test("find: the pick list asks for Tab-fill; a null pick (cancel or fill) selects nothing; next then starts at the first match, without --unfold", async () => {
  const { fake, run } = setup();
  let options: unknown;
  fake.api.pick = async (_title, _candidates, _multi, opts) => {
    options = opts;
    return null;
  };
  assert.equal(code(await run("find", { unfold: true }, "kick")), ExitCode.OK);
  assert.deepEqual(options, { fill: true });
  assert.equal(fake.bridge.calls.length, 0);
  assert.equal(code(await run("next", {})), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[0]!.args.route, [0, 0, 0]);
  assert.equal(fake.bridge.calls[0]!.args.showChains, undefined);
});

test("find --first / --last select without the pick list and next/prev continue from there", async () => {
  const { fake, run } = setup();
  fake.api.pick = async () => assert.fail("no pick list");
  assert.equal(code(await run("find", { first: true }, "kick")), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[0]!.args.route, [0, 0, 0]);
  assert.equal(code(await run("next", {})), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[1]!.args.route, [1]);
  assert.equal(code(await run("find", { last: true }, "kick")), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[2]!.args.route, [1]);
  assert.equal(code(await run("prev", {})), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[3]!.args.route, [0, 0, 0]);
});

test("find --first with one match changes nothing; with both flags it is a usage error", async () => {
  const { fake, run } = setup();
  assert.equal(code(await run("find", { first: true }, "snare")), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls.map((c) => c.args.route), [[0, 0, 1]]);
  assert.equal(code(await run("find", { first: true, last: true }, "kick")), ExitCode.USAGE);
  assert.equal(fake.bridge.calls.length, 1);
});

test("only the last find is the list: another pick list does not replace it", async () => {
  const { fake, run, answer } = setup();
  answer((c) => [c[0]!]);
  await run("find", {}, "kick"); // list: pad, Kick Bus; current = pad
  fake.api.pick(("goto" as never), [nodes[3]!] as never, false); // some other pick: must not touch the list
  assert.equal(code(await run("next", {})), ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[1]!.args.route, [1]);
});

test("find: next/prev are subcommands and win over a pattern word; a flag first keeps the word a pattern", async () => {
  const { fake } = setup();
  const { parse } = await import("../../core/command/parse.js");
  const next = parse("find next", fake.commands);
  assert.equal(next.kind, "run");
  if (next.kind === "run") assert.deepEqual(next.invocation.path, ["find", "next"]);
  const word = parse("find -t next", fake.commands);
  assert.equal(word.kind, "run");
  if (word.kind === "run") assert.deepEqual(word.invocation.path, ["find"]);
  const both = parse("find kick next", fake.commands);
  if (both.kind === "run") assert.deepEqual(both.invocation.path, ["find"]);
});
