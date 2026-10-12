import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeBridge } from "../ableton/bridgeFake.js";
import { TEXT_FORBIDDEN, TEXT_STALE, fail as bridgeFail } from "../ableton/bridgeProtocol.js";
import { ExitCode } from "../core/types.js";
import { setChainSwitch } from "./chainSwitch.js";

const kick = { scope: "regular" as const, route: [0, 1, 0], name: "Kick" };
const snare = { scope: "regular" as const, route: [0, 1, 1], name: "Snare" };

// Rack [0,1] holds Kick (muted, soloed) and Snare (neither).
const chainsOp = (args: Record<string, unknown>) => ({
  ok: true as const,
  value: {
    racks: (args.targets as unknown[]).map(() => ({
      kind: "drum",
      total: 2,
      offset: 0,
      chains: [{ name: "Kick", mute: true, solo: true }, { name: "Snare" }],
    })),
  },
});
type Target = { route: number[]; mute?: boolean; solo?: boolean };
const setOp = (args: Record<string, unknown>) => ({
  ok: true as const,
  value: {
    chains: (args.targets as Target[]).map((t) => ({
      name: t.route[2] === 0 ? "Kick" : "Snare",
      mute: t.mute ?? (t.route[2] === 0),
      solo: t.solo ?? (t.route[2] === 0),
    })),
  },
});

test("toggle: the chain's own read value is negated, written once", async () => {
  const bridge = createFakeBridge({ ops: { chains: chainsOp, chain_set: setOp } });
  const result = await setChainSwitch(bridge, [kick, snare], "mute", "toggle");
  assert.deepEqual(result, [{ ok: true }, { ok: true }]);
  const write = bridge.calls.find((c) => c.op === "chain_set")!;
  assert.deepEqual(write.args.targets, [
    { scope: "regular", route: [0, 1, 0], expectName: "Kick", mute: false }, // was muted
    { scope: "regular", route: [0, 1, 1], expectName: "Snare", mute: true }, // was not
  ]);
});

test("set: unmute writes false without reading first", async () => {
  const bridge = createFakeBridge({ ops: { chain_set: setOp } });
  const result = await setChainSwitch(bridge, [kick], "mute", false);
  assert.deepEqual(result, [{ ok: true }]);
  assert.equal(bridge.calls.some((c) => c.op === "chains"), false);
  assert.deepEqual(bridge.calls[0]!.args.targets, [{ scope: "regular", route: [0, 1, 0], expectName: "Kick", mute: false }]);
});

test("script unavailable: every chain fails with the bridge's code and text", async () => {
  const bridge = createFakeBridge({ running: false, unavailableText: "Remote Script not running" });
  const result = await setChainSwitch(bridge, [kick, snare], "solo", "toggle");
  assert.deepEqual(result, [
    { ok: false, code: ExitCode.UNAVAILABLE, message: "Remote Script not running" },
    { ok: false, code: ExitCode.UNAVAILABLE, message: "Remote Script not running" },
  ]);
});

test("token refused: code 5 and the bridge's text on every chain", async () => {
  const bridge = createFakeBridge({
    ops: { chains: chainsOp, chain_set: () => bridgeFail(ExitCode.UNAVAILABLE, TEXT_FORBIDDEN) },
  });
  const result = await setChainSwitch(bridge, [kick], "mute", "toggle");
  assert.deepEqual(result, [{ ok: false, code: ExitCode.UNAVAILABLE, message: TEXT_FORBIDDEN }]);
});

test("an entry that fails alone: the others are still done", async () => {
  const bridge = createFakeBridge({
    ops: {
      chains: chainsOp,
      chain_set: (args) => {
        const tgt = args.targets as Target[];
        return {
          ok: true,
          value: { chains: tgt.map((t) => (t.route[2] === 0 ? { error: { code: "stale", text: "x" } } : { name: "Snare", mute: true, solo: false })) },
        };
      },
    },
  });
  const result = await setChainSwitch(bridge, [kick, snare], "mute", "toggle");
  assert.deepEqual(result, [{ ok: false, code: 1, message: TEXT_STALE }, { ok: true }]);
});

test("a stale name in the read stops that chain before any write", async () => {
  const bridge = createFakeBridge({ ops: { chains: chainsOp, chain_set: setOp } });
  const result = await setChainSwitch(bridge, [{ ...kick, name: "Old name" }, snare], "mute", "toggle");
  assert.equal(result[0]!.ok, false);
  assert.equal(result[0]!.message, TEXT_STALE);
  assert.equal(result[1]!.ok, true);
  assert.equal((bridge.calls.find((c) => c.op === "chain_set")!.args.targets as unknown[]).length, 1);
});

test("a read-back that differs from what was written is a failure", async () => {
  const bridge = createFakeBridge({
    ops: { chain_set: () => ({ ok: true, value: { chains: [{ name: "Kick", mute: true, solo: false }] } }) },
  });
  const result = await setChainSwitch(bridge, [kick], "mute", false);
  assert.deepEqual(result, [{ ok: false, message: "did not change" }]);
});
