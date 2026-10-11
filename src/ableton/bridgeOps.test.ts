import { test } from "node:test";
import assert from "node:assert/strict";
import { select } from "./bridgeOps.js";
import { createFakeBridge } from "./bridgeFake.js";
import { fail } from "./bridgeProtocol.js";

const node = { scope: "regular" as const, route: [2, 1], name: "EQ Eight" };

test("select sends scope, route and expectName and returns the read-back name", async () => {
  const bridge = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "EQ Eight" } }) } });
  assert.deepEqual(await select(bridge, node), { ok: true, value: { name: "EQ Eight" } });
  assert.deepEqual(bridge.calls, [{ op: "select", args: { scope: "regular", route: [2, 1], expectName: "EQ Eight" }, changes: true }]);
});

test("select passes failures through and rejects a reply without a name", async () => {
  const stale = createFakeBridge({ ops: { select: () => fail(1, "the Live Set changed; run the command again") } });
  assert.deepEqual(await select(stale, node), { ok: false, code: 1, text: "the Live Set changed; run the command again" });
  const odd = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: 3 } }) } });
  const r = await select(odd, node);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 1);
  const down = createFakeBridge({ running: false });
  assert.equal((await select(down, node)).ok, false);
});
