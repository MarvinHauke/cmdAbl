import { test } from "node:test";
import assert from "node:assert/strict";
import type { FakeBridgeOptions } from "../ableton/bridgeFake.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { createFakeApi } from "./testPorts.js";
import { readSwitchStates } from "./trackSetState.js";

const node = (handleId: string, kind: ObjectNode["kind"], route: number[], name = handleId): ObjectNode =>
  ({ handleId, kind, route, scope: "regular", name, path: `/${name}`, children: [] }) as ObjectNode;
const A = node("A", "track", [0]);
const B = node("B", "track", [1]);
const KICK = node("Kick", "chain", [0, 1, 0]);
const SNARE = node("Snare", "chain", [0, 1, 1]);

const chainsOp: NonNullable<FakeBridgeOptions["ops"]>[string] = (args) => ({
  ok: true,
  value: {
    racks: (args.targets as unknown[]).map(() => ({
      kind: "drum", total: 2, offset: 0,
      chains: [{ name: "Kick", mute: true }, { name: "Snare", solo: true }],
    })),
  },
});

function setup(nodes: ObjectNode[], bridge?: FakeBridgeOptions, state: Record<string, { mute?: boolean; solo?: boolean; arm?: boolean }> = {}) {
  const fake = createFakeApi({ nodes, bridge });
  for (const [id, s] of Object.entries(state)) fake.tracks.set(id, { mute: false, solo: false, arm: false, ...s });
  return fake;
}

test("tracks only: read from the SDK port, the bridge is never asked", async () => {
  const fake = setup([A, B], { running: false }, { B: { mute: true } });
  assert.deepEqual(await readSwitchStates(fake.api, "mute", [A, B]), [false, true]);
  assert.equal(fake.bridge.calls.length, 0);
  assert.equal(fake.bridge.state(), "unknown");
});

test("mixed tracks and chains: one chains request, candidate order kept", async () => {
  const fake = setup([A, B], { ops: { chains: chainsOp } }, { B: { mute: true } });
  assert.deepEqual(await readSwitchStates(fake.api, "mute", [KICK, A, SNARE, B]), [true, false, false, true]);
  assert.deepEqual(await readSwitchStates(fake.api, "solo", [SNARE, KICK]), [true, false]);
  assert.equal(fake.bridge.calls.filter((c) => c.op === "chains").length, 2); // one per call, not per chain
});

test("script missing: chains unknown, tracks still read", async () => {
  const fake = setup([A, B], { running: false }, { A: { solo: true } });
  assert.deepEqual(await readSwitchStates(fake.api, "solo", [A, KICK, B]), [true, null, false]);
  // known unavailable now: no second hello, no request
  assert.deepEqual(await readSwitchStates(fake.api, "solo", [KICK]), [null]);
  assert.equal(fake.bridge.calls.length, 0);
});

test("a chain entry that fails alone is unknown; the rest are read", async () => {
  const fake = setup([], {
    ops: {
      chains: () => ({
        ok: true,
        value: { racks: [{ kind: "drum", total: 1, offset: 0, chains: [{ name: "Other", mute: true }] }] },
      }),
    },
  });
  // the name asked for no longer matches the chain at that position → stale entry → null
  assert.deepEqual(await readSwitchStates(fake.api, "mute", [KICK]), [null]);
});

test("arm: the script's value wins over the SDK's stale one; null means not armed", async () => {
  const wire = (arm: boolean | null) => ({ can_be_armed: arm !== null, is_foldable: false, is_grouped: false, arm });
  let n = 0;
  const answers = [wire(false), wire(null)];
  const fake = setup([A, B], {
    ops: { track_facts: (args) => ({ ok: true, value: { tracks: (args.targets as unknown[]).map(() => answers[n++ % 2]) } }) },
  }, { A: { arm: true }, B: { arm: true } }); // SDK says armed for both
  assert.deepEqual(await readSwitchStates(fake.api, "arm", [A, B]), [false, false]);
  assert.equal(fake.bridge.calls.filter((c) => c.op === "track_facts").length, 1);
});

test("arm without the script: the SDK's value, no wait", async () => {
  const fake = setup([A, B], { running: false }, { B: { arm: true } });
  assert.deepEqual(await readSwitchStates(fake.api, "arm", [A, B]), [false, true]);
});

test("never throws: a track the port cannot find is unknown", async () => {
  const fake = setup([], { running: false });
  assert.deepEqual(await readSwitchStates(fake.api, "mute", [A]), [null]);
});
