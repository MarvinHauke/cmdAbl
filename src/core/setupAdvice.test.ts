import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXT_NOT_RUNNING } from "../ableton/bridgeProtocol.js";
import { adviseRemoteScript } from "./setupAdvice.js";

const running = (script: string) => ({ ok: true as const, value: { script, v: 1, ops: ["hello"] } });
const SHIPPED = "0.1.0";

test("advice: same version everywhere still says to restart if files were just updated", () => {
  const text = adviseRemoteScript({ shipped: SHIPPED, installed: { status: "current", version: SHIPPED }, running: running(SHIPPED) });
  assert.match(text, /^Remote Script 0\.1\.0 is installed and running\./);
  assert.match(text, /just updated, restart Live once/);
  assert.match(text, /otherwise there is nothing to do/);
});

test("advice: installed X, running Y → restart Live (Live keeps the old Python loaded)", () => {
  const text = adviseRemoteScript({ shipped: SHIPPED, installed: { status: "current", version: SHIPPED }, running: running("0.0.9") });
  assert.match(text, /Live still runs 0\.0\.9\. Restart Live to load Remote Script 0\.1\.0\./);
});

test("advice: installed but not running → restart if needed and enable the control surface", () => {
  const text = adviseRemoteScript({
    shipped: SHIPPED,
    installed: { status: "current", version: SHIPPED },
    running: { ok: false, code: 5, text: TEXT_NOT_RUNNING },
  });
  assert.match(text, /is installed but not running\. Restart Live/);
  assert.match(text, /enable cmdAbl as a control surface/);
  assert.doesNotMatch(text, /Remote Script not running/); // not nested in the sentence
  const other = adviseRemoteScript({
    shipped: SHIPPED,
    installed: { status: "current", version: SHIPPED },
    running: { ok: false, code: 1, text: "bridge failed: boom" },
  });
  assert.match(other, /not running \(bridge failed: boom\)\./);
});

test("advice: an outdated or missing installed copy is named, not papered over", () => {
  assert.match(
    adviseRemoteScript({ shipped: SHIPPED, installed: { status: "outdated", version: "0.0.3" }, running: null }),
    /installed copy is version 0\.0\.3, this extension ships 0\.1\.0\. See the lines above/,
  );
  assert.match(adviseRemoteScript({ shipped: SHIPPED, installed: { status: "outdated", version: null }, running: null }), /unversioned copy/);
  assert.match(adviseRemoteScript({ shipped: SHIPPED, installed: { status: "missing" }, running: null }), /not installed/);
});

test("advice: an unreadable install (other platform) is judged by the running script", () => {
  assert.match(
    adviseRemoteScript({ shipped: SHIPPED, installed: { status: "unknown" }, running: running(SHIPPED) }),
    /and running\. If the script or cmdAbl was just updated/,
  );
  assert.match(
    adviseRemoteScript({ shipped: SHIPPED, installed: { status: "unknown" }, running: running("0.0.9") }),
    /Restart Live to load Remote Script 0\.1\.0/,
  );
  assert.match(adviseRemoteScript({ shipped: SHIPPED, installed: { status: "unknown" }, running: null }), /not running/);
});
