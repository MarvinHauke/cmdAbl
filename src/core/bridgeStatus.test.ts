import { test } from "node:test";
import assert from "node:assert/strict";
import { reportBridge } from "./bridgeStatus.js";
import { ExitCode } from "../types.js";
import { TEXT_NOT_INSTALLED, type BridgeResult, type HelloInfo } from "../ableton/bridgeProtocol.js";

function clock(...ticks: number[]) {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)]!;
}
const probe = (answer: BridgeResult<HelloInfo> | Error) => ({
  ping: async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  },
});

test("reportBridge: a running script is reported with version, protocol, ms and operations", async () => {
  const r = await reportBridge(
    probe({ ok: true, value: { script: "0.1.0", v: 1, ops: ["hello", "select_track"] } }),
    clock(1000, 1012),
  );
  assert.equal(r.available, true);
  assert.equal(r.ms, 12);
  assert.equal(r.result.code, ExitCode.OK);
  assert.equal(r.result.message, "Remote Script 0.1.0 is running (protocol v1, 12 ms; operations: hello, select_track)");
  assert.equal(r.line, `available: ${r.result.message}`);
});

test("reportBridge: an unavailable bridge keeps its own text and exit code", async () => {
  const r = await reportBridge(
    probe({ ok: false, code: ExitCode.UNAVAILABLE, text: TEXT_NOT_INSTALLED }),
    clock(0, 503),
  );
  assert.equal(r.available, false);
  assert.equal(r.result.code, ExitCode.UNAVAILABLE);
  assert.equal(r.result.message, TEXT_NOT_INSTALLED);
  assert.equal(r.line, `unavailable: ${TEXT_NOT_INSTALLED} (after 503 ms)`);
});

test("reportBridge: a throwing probe becomes a failure result", async () => {
  const r = await reportBridge(probe(new Error("socket gone")), clock(0, 1));
  assert.equal(r.available, false);
  assert.equal(r.result.code, ExitCode.FAILURE);
  assert.match(r.result.message ?? "", /socket gone/);
});
