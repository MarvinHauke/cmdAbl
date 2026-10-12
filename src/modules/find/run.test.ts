import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ExitCode, type CommandResult } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
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
const selectOk = (args: Record<string, unknown>) => ({
  ok: true as const,
  value: { name: String(args.expectName) },
});

function setup() {
  const fake = createFakeApi({ nodes, bridge: { ops: { select: selectOk } } });
  // Like the platform: a pick list's answer is announced to the listeners.
  const listeners: Array<(c: ObjectNode[], chosen: ObjectNode[] | null) => void> = [];
  fake.api.onPick = (l) => void listeners.push(l);
  const answer = (choose: (c: ObjectNode[]) => ObjectNode[] | null) => {
    fake.api.pick = async (_title, candidates) => {
      const chosen = choose(candidates);
      for (const l of listeners) l(candidates, chosen);
      return chosen;
    };
  };
  activate(fake.api);
  const cmd = (name: string) => fake.commands.find((c) => c.name === name)!;
  const run = async (name: string, options: Record<string, string | true>, pattern?: string) =>
    (await cmd(name).run!(
      { path: [name], options, args: pattern === undefined ? [] : [[pattern]] } as never,
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
