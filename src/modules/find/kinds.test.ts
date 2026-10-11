import { test } from "node:test";
import assert from "node:assert/strict";
import { findKinds } from "./kinds.js";

test("findKinds: no flag searches everything, flags add up", () => {
  assert.deepEqual(findKinds({}), ["track", "device", "chain"]);
  assert.deepEqual(findKinds({ tracks: true }), ["track"]);
  assert.deepEqual(findKinds({ devices: true }), ["device"]);
  assert.deepEqual(findKinds({ chains: true }), ["chain"]);
  assert.deepEqual(findKinds({ tracks: true, chains: true }), ["track", "chain"]);
});
