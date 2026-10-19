import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { TEXT_STALE, fail as bridgeFail } from "../../ableton/bridgeProtocol.js";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

const node = (handleId: string, kind: ObjectNode["kind"], route: number[], path: string, name: string): ObjectNode =>
  ({ handleId, kind, route, scope: "regular", name, path, children: [] }) as ObjectNode;
const nodes = [
  node("1", "track", [0], "/Vermona MIDI", "Vermona MIDI"),
  node("2", "device", [0, 0], "/Vermona MIDI/Drum Rack", "Drum Rack"),
  node("3", "chain", [0, 0, 1], "/Vermona MIDI/Drum Rack/Kick", "Kick"),
];

const run = (fake: ReturnType<typeof createFakeApi>, target: ObjectNode, options: Record<string, string | true> = {}) =>
  fake.commands[0]!.run!({ path: ["goto"], options, args: [[target]] } as never, undefined as never);

test("goto: the palette gets one row per object, with the unique path", () => {
  const fake = createFakeApi({ nodes });
  activate(fake.api);
  const items = fake.providers[0]!.getItems() as Array<{ id: string; type: string; path?: string }>;
  assert.deepEqual(items.map((i) => [i.id, i.type, i.path]), [
    ["1", "track", "/Vermona MIDI"],
    ["2", "device", "/Vermona MIDI/Drum Rack"],
    ["3", "chain", "/Vermona MIDI/Drum Rack/Kick"],
  ]);
});

test("goto: selects through the bridge with scope, route and the expected name", async () => {
  const fake = createFakeApi({ nodes, bridge: { ops: { select: () => ({ ok: true, value: { name: "Kick" } }) } } });
  activate(fake.api);
  const result = await run(fake, nodes[2]!);
  assert.equal((result as { code?: number } | void)?.code ?? ExitCode.OK, ExitCode.OK);
  assert.deepEqual(fake.bridge.calls[0]!.args, { scope: "regular", route: [0, 0, 1], expectName: "Kick" });
  assert.equal(fake.commands[0]!.requires?.includes("bridge"), true);
});

test("goto --unfold asks for the chains, a failed select keeps the bridge's code and text", async () => {
  const fake = createFakeApi({ nodes, bridge: { ops: { select: () => bridgeFail(1, TEXT_STALE) } } });
  activate(fake.api);
  const result = (await run(fake, nodes[0]!, { unfold: true })) as { code: number; message: string };
  assert.equal(fake.bridge.calls[0]!.args.showChains, true);
  assert.equal(result.code, ExitCode.FAILURE);
  assert.equal(result.message, TEXT_STALE);
});
