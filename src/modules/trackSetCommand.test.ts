import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command } from "../commandRegistry.js";
import { resolvePath } from "../ableton/resolvePath.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import type { ModuleApi } from "./types.js";
import { registerTrackSetCommand, type TrackSetDocs } from "./trackSetCommand.js";

const docs: TrackSetDocs = { description: "d", examples: [{ line: "x" }], targetSummary: "t" };

const node = (name: string, kind: string, route: number[]): ObjectNode =>
  ({ handleId: name, route, kind, scope: "regular", name, path: `/${name}`, children: [] }) as unknown as ObjectNode;

test("arm/unarm accept tracks only; mute/solo also chains — a device is never offered", () => {
  const commands: Command[] = [];
  const api = { commands: { add: (c: Command) => commands.push(c) } } as unknown as ModuleApi;
  registerTrackSetCommand(api, "mute", "mute", "toggle", "s", docs);
  registerTrackSetCommand(api, "unmute", "mute", false, "s", docs);
  registerTrackSetCommand(api, "solo", "solo", "toggle", "s", docs);
  registerTrackSetCommand(api, "unsolo", "solo", false, "s", docs);
  registerTrackSetCommand(api, "arm", "arm", "toggle", "s", docs);
  registerTrackSetCommand(api, "unarm", "arm", false, "s", docs);
  assert.equal(commands.length, 6);

  const tree = [node("Kick", "track", [0]), node("Kick", "device", [0, 0]), node("Kick", "chain", [0, 0, 0])];
  for (const c of commands) {
    const def = c.args?.[0];
    const armCommand = c.name === "arm" || c.name === "unarm";
    assert.deepEqual(def?.kinds, armCommand ? ["track"] : ["track", "chain"], c.name);
    // what the platform resolves for such an argument: never the device
    const found = resolvePath(tree, "Kick", def?.kinds);
    assert.deepEqual(found.map((n) => n.kind), armCommand ? ["track"] : ["track", "chain"], c.name);
  }
});

// ── the command end to end, with fakes ──────────────────────────────────────
import { createFakeBridge } from "../ableton/bridgeFake.js";
import { ExitCode, type CommandResult } from "../types.js";

function setup(bridge: ReturnType<typeof createFakeBridge>, name: string, prop: "mute" | "solo", value: boolean | "toggle") {
  const tracks = [{ mute: false, solo: false, arm: false }, { mute: true, solo: false, arm: false }];
  const api = {
    context: {
      application: { song: { tracks, returnTracks: [], mainTrack: {} } },
      withinTransaction: (fn: () => void) => fn(),
    },
    commands: { add: (c: Command) => (command = c) },
  } as unknown as ModuleApi;
  let command: Command | undefined;
  registerTrackSetCommand(api, name, prop, value, "s", docs, () => bridge);
  const run = async (targets: ObjectNode[]) =>
    (command!.run as (i: unknown, p: unknown) => Promise<CommandResult | void>)(
      { path: [name], options: {}, args: [targets] },
      undefined,
    );
  return { tracks, run };
}

const chainsOp = (args: Record<string, unknown>) => ({
  ok: true as const,
  value: {
    racks: (args.targets as unknown[]).map(() => ({ kind: "drum", total: 1, offset: 0, chains: [{ name: "Kick" }] })),
  },
});
const setOp = (args: Record<string, unknown>) => ({
  ok: true as const,
  value: { chains: (args.targets as Array<{ mute?: boolean; solo?: boolean }>).map((t) => ({ name: "Kick", mute: t.mute ?? false, solo: t.solo ?? false })) },
});

test("mute on tracks and a chain: tracks through the SDK, the chain through the bridge, results in typed order", async () => {
  const bridge = createFakeBridge({ ops: { chains: chainsOp, chain_set: setOp } });
  const { tracks, run } = setup(bridge, "mute", "mute", "toggle");
  const result = await run([node("A", "track", [0]), node("Kick", "chain", [0, 1, 0]), node("B", "track", [1])]);
  assert.equal(result?.code ?? 0, ExitCode.OK);
  assert.equal(tracks[0]!.mute, true);
  assert.equal(tracks[1]!.mute, false);
  assert.deepEqual(bridge.calls.find((c) => c.op === "chain_set")!.args.targets, [
    { scope: "regular", route: [0, 1, 0], expectName: "Kick", mute: true },
  ]);
});

test("only tracks: the bridge is never asked (the script is not needed)", async () => {
  const bridge = createFakeBridge({ running: false });
  const { tracks, run } = setup(bridge, "mute", "mute", "toggle");
  const result = await run([node("A", "track", [0])]);
  assert.equal(result?.code ?? 0, ExitCode.OK);
  assert.equal(tracks[0]!.mute, true);
  assert.equal(bridge.calls.length, 0);
  assert.equal(bridge.state(), "unknown");
});

test("a chain and the script unavailable: the track is done, the chain fails with the bridge's text", async () => {
  const bridge = createFakeBridge({ running: false, unavailableText: "Remote Script not running" });
  const { tracks, run } = setup(bridge, "mute", "mute", "toggle");
  const result = await run([node("A", "track", [0]), node("Kick", "chain", [0, 1, 0])]);
  assert.equal(tracks[0]!.mute, true);
  assert.equal(result?.code, ExitCode.FAILURE);
  assert.equal(result?.message, "mute: 1 of 2 done");
  assert.deepEqual(result?.details, [
    { path: "/A", ok: true },
    { path: "/Kick", ok: false, code: ExitCode.UNAVAILABLE, message: "Remote Script not running" },
  ]);
});

test("only chains and the script unavailable: exit code 5", async () => {
  const bridge = createFakeBridge({ running: false, unavailableText: "Remote Script not running" });
  const { run } = setup(bridge, "unmute", "mute", false);
  const result = await run([node("Kick", "chain", [0, 1, 0])]);
  assert.equal(result?.code, ExitCode.UNAVAILABLE);
});
