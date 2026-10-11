import { test } from "node:test";
import assert from "node:assert/strict";
import { median, reportBridge, ROUND_TRIPS } from "./bridgeStatus.js";
import { ExitCode } from "../types.js";
import { SCRIPT_VERSION, TEXT_NOT_INSTALLED, type BridgeResult, type HelloInfo } from "../ableton/bridgeProtocol.js";

// The version this extension ships, so the tests do not break on a version bump.
const HELLO: HelloInfo = { script: SCRIPT_VERSION, v: 1, ops: ["hello", "select"] };
const OTHER_VERSION = `${SCRIPT_VERSION}.other`;

/** A probe whose n-th ping takes durations[n] ms on a fake clock (or fails / throws). */
function scripted(steps: Array<number | { fail: string } | { throws: string }>, hello: HelloInfo = HELLO) {
  let clock = 1000;
  let sent = 0;
  let inFlight = 0;
  let overlapped = false;
  return {
    now: () => clock,
    get sent() {
      return sent;
    },
    get overlapped() {
      return overlapped;
    },
    probe: {
      ping: async (): Promise<BridgeResult<HelloInfo>> => {
        if (++inFlight > 1) overlapped = true;
        const step = steps[sent++] ?? 5;
        await Promise.resolve();
        inFlight--;
        if (typeof step === "number") {
          clock += step;
          return { ok: true, value: hello };
        }
        clock += 1;
        if ("throws" in step) throw new Error(step.throws);
        return { ok: false, code: ExitCode.UNAVAILABLE, text: step.fail };
      },
    },
  };
}

test("median: odd, even and single", () => {
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 9]), 2);
  assert.equal(median([1, 2, 4, 9]), 3);
  assert.equal(median([1, 2, 3, 9]), 3); // 2.5 rounds to 3
});

test("reportBridge: 20 round trips, one after the other, as min / median / max", async () => {
  const durations = Array.from({ length: ROUND_TRIPS }, (_, i) => (i === 0 ? 14 : i === 1 ? 6 : i === 2 ? 97 : 20 + i));
  const run = scripted(durations);
  const pauses: number[] = [];
  const r = await reportBridge(run.probe, run.now, {
    sleep: async (ms) => void pauses.push(ms),
    random: () => 0.5,
  });
  assert.equal(run.sent, 20);
  assert.deepEqual(pauses, Array(19).fill(75), "a pause before each further ping, within 0..150 ms");
  assert.equal(run.overlapped, false, "pings are sequential");
  const sorted = [...durations].sort((a, b) => a - b);
  assert.equal(r.available, true);
  assert.equal(r.result.code, ExitCode.OK);
  assert.equal(
    r.result.message,
    `Remote Script ${SCRIPT_VERSION} is running (protocol v1; 20 round trips: min 6 ms, median ${r.ms} ms, max 97 ms; operations: hello, select)`,
  );
  assert.equal(r.ms, Math.round((sorted[9]! + sorted[10]!) / 2));
  assert.equal(r.line, `available: ${r.result.message}`);
});

test("reportBridge: a failing first ping is today's failure and sends nothing more", async () => {
  const run = scripted([{ fail: TEXT_NOT_INSTALLED }]);
  const r = await reportBridge(run.probe, run.now, { sleep: async () => {} });
  assert.equal(run.sent, 1);
  assert.equal(r.available, false);
  assert.equal(r.result.code, ExitCode.UNAVAILABLE);
  assert.equal(r.result.message, TEXT_NOT_INSTALLED);
  assert.equal(r.line, `unavailable: ${TEXT_NOT_INSTALLED} (after 1 ms)`);
});

test("reportBridge: a ping failing in the middle reports how many answered, exit 1", async () => {
  const run = scripted([10, 11, 12, 13, { fail: "the Remote Script did not answer; check Live" }]);
  const r = await reportBridge(run.probe, run.now, { sleep: async () => {} });
  assert.equal(run.sent, 5, "stops at the failure");
  assert.equal(r.available, false);
  assert.equal(r.result.code, ExitCode.FAILURE);
  assert.match(r.line, /^unstable: /);
  assert.equal(
    r.result.message,
    `Remote Script ${SCRIPT_VERSION} answered 4 of 20 round trips, then failed: the Remote Script did not answer; check Live`,
  );
});

test("reportBridge: a throwing probe becomes a failure result", async () => {
  const first = scripted([{ throws: "socket gone" }]);
  const a = await reportBridge(first.probe, first.now, { sleep: async () => {} });
  assert.equal(a.result.code, ExitCode.FAILURE);
  assert.match(a.result.message ?? "", /socket gone/);
  const later = scripted([10, { throws: "socket gone" }]);
  const b = await reportBridge(later.probe, later.now, { sleep: async () => {} });
  assert.equal(b.result.code, ExitCode.FAILURE);
  assert.match(b.result.message ?? "", /answered 1 of 20.*socket gone/);
});

test("reportBridge: a script of another version gets the shipped version in the text", async () => {
  const run = scripted([5, 5, 5], { ...HELLO, script: OTHER_VERSION });
  const r = await reportBridge(run.probe, run.now, { roundTrips: 3, sleep: async () => {} });
  assert.match(
    r.result.message ?? "",
    new RegExp(`^Remote Script ${OTHER_VERSION.replace(/\./g, "\\.")} \\(this extension ships ${SCRIPT_VERSION.replace(/\./g, "\\.")}\\) is running \\(protocol v1; 3 round trips: min 5 ms, median 5 ms, max 5 ms;`),
  );
  const same = scripted([5, 5, 5]);
  const s = await reportBridge(same.probe, same.now, { roundTrips: 3, sleep: async () => {} });
  assert.doesNotMatch(s.result.message ?? "", /ships/);
});
