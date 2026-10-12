import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeBridge } from "../ableton/bridgeFake.js";
import { TEXT_STALE, fail as bridgeFail } from "../ableton/bridgeProtocol.js";
import { ExitCode } from "../types.js";
import { selectNodeResult } from "./selectNode.js";

const node = { scope: "regular" as const, route: [2, 1], name: "Kick" };

test("selectNodeResult: ok sends scope, route and the expected name", async () => {
  const bridge = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "Kick" } }) } });
  const result = await selectNodeResult(bridge, node);
  assert.equal(result.code, ExitCode.OK);
  assert.deepEqual(bridge.calls[0], {
    op: "select",
    args: { scope: "regular", route: [2, 1], expectName: "Kick" },
    changes: true,
  });
});

test("selectNodeResult: a stale Set gives the bridge's code 1 and text unchanged", async () => {
  const bridge = createFakeBridge({ ops: { select: () => bridgeFail(1, TEXT_STALE) } });
  const result = await selectNodeResult(bridge, node);
  assert.equal(result.code, ExitCode.FAILURE);
  assert.equal(result.message, TEXT_STALE);
});

test("selectNodeResult: script not running gives code 5 with the bridge's text", async () => {
  const bridge = createFakeBridge({ running: false, unavailableText: "Remote Script not running" });
  const result = await selectNodeResult(bridge, node);
  assert.equal(result.code, ExitCode.UNAVAILABLE);
  assert.equal(result.message, "Remote Script not running");
});

test("selectNodeResult: an outdated script (op unknown) gives code 5", async () => {
  const bridge = createFakeBridge({ ops: {} });
  const result = await selectNodeResult(bridge, node);
  assert.equal(result.code, ExitCode.UNAVAILABLE);
});

test("selectNodeResult: --unfold asks for showChains; false is a hint, null and true are silent, default asks for nothing", async () => {
  for (const [shown, expectMessage] of [[true, false], [null, false], [false, true]] as const) {
    const bridge = createFakeBridge({
      ops: { select: () => ({ ok: true, value: { name: "Kick", ...(shown === null ? {} : { is_showing_chains: shown }) } }) },
    });
    const result = await selectNodeResult(bridge, node, { unfold: true });
    assert.equal(result.code, ExitCode.OK);
    assert.equal(bridge.calls[0]!.args.showChains, true);
    assert.equal(result.message !== undefined, expectMessage, String(shown));
  }
  const plain = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "Kick", is_showing_chains: false } }) } });
  const result = await selectNodeResult(plain, node);
  assert.equal(result.message, undefined);
  assert.equal("showChains" in plain.calls[0]!.args, false);
});
