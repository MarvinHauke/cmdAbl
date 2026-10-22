import { test } from "node:test";
import assert from "node:assert/strict";
import { readVolume, writeVolume, type VolumeTrack } from "./volume.js";

const track = (state = { v: 0.85 }): VolumeTrack & { state: { v: number } } => ({
  state,
  mixer: { volume: { getValue: async () => state.v, setValue: async (v) => void (state.v = v) } },
});

test("readVolume: the value, or null for no track or a failing read", async () => {
  assert.equal(await readVolume(track()), 0.85);
  assert.equal(await readVolume(null), null);
  const bad: VolumeTrack = { mixer: { volume: { getValue: async () => { throw new Error("x"); }, setValue: async () => {} } } };
  assert.equal(await readVolume(bad), null);
  const nan: VolumeTrack = { mixer: { volume: { getValue: async () => NaN, setValue: async () => {} } } };
  assert.equal(await readVolume(nan), null);
});

test("writeVolume: clamps to 0..1, starts synchronously, never throws", async () => {
  const t = track();
  const pending = writeVolume(t, 0.5);
  assert.equal(t.state.v, 0.5); // the write already started
  assert.equal(await pending, true);
  assert.equal(await writeVolume(t, 2), true);
  assert.equal(t.state.v, 1);
  await writeVolume(t, -3);
  assert.equal(t.state.v, 0);
  assert.equal(await writeVolume(t, NaN), false);
  assert.equal(await writeVolume(null, 0.5), false);
  const sync: VolumeTrack = { mixer: { volume: { getValue: async () => 0, setValue: () => { throw new Error("x"); } } } };
  assert.equal(await writeVolume(sync, 0.5), false);
  const rejects: VolumeTrack = { mixer: { volume: { getValue: async () => 0, setValue: async () => { throw new Error("x"); } } } };
  assert.equal(await writeVolume(rejects, 0.5), false);
});
