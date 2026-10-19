import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeRequest, mapScriptError, parseHello, parseReply, PROTOCOL_VERSION, SCRIPT_VERSION, TEXT_OUTDATED, TEXT_STALE } from "./bridgeProtocol.js";
import { parseScriptVersion, inspectInstalledScript } from "./installedScript.js";
import { readFileSync } from "node:fs";

test("encodeRequest carries v, id, op and args", () => {
  assert.deepEqual(JSON.parse(encodeRequest("r1", "hello")), { v: PROTOCOL_VERSION, id: "r1", op: "hello", args: {} });
});

test("parseReply validates every shape and never throws", () => {
  assert.equal(parseReply("nope").kind, "malformed");
  assert.equal(parseReply("[1]").kind, "malformed");
  assert.equal(parseReply('{"v":1,"ok":true,"result":{}}').kind, "malformed"); // no id
  assert.equal(parseReply('{"v":1,"id":"a","ok":true}').kind, "malformed"); // no result
  assert.equal(parseReply('{"v":1,"id":"a","ok":false,"error":{"code":"x"}}').kind, "malformed");
  assert.deepEqual(parseReply('{"v":1,"id":"a","ok":true,"result":{"n":1}}'), { kind: "ok", id: "a", v: 1, result: { n: 1 } });
  assert.deepEqual(parseReply('{"v":1,"id":"a","ok":false,"error":{"code":"stale","text":"t"}}'), {
    kind: "error", id: "a", v: 1, code: "stale", text: "t",
  });
});

test("parseHello rejects wrong shapes", () => {
  assert.equal(parseHello({ script: "0.1.0", v: 1, ops: [1] }), null);
  assert.deepEqual(parseHello({ script: "0.1.0", v: 1, ops: ["hello"] }), { script: "0.1.0", v: 1, ops: ["hello"] });
});

test("script errors map to exit codes (0001 §2)", () => {
  assert.deepEqual(mapScriptError("stale", "x"), { ok: false, code: 1, text: TEXT_STALE });
  assert.deepEqual(mapScriptError("out_of_range", "x"), { ok: false, code: 1, text: TEXT_STALE });
  assert.deepEqual(mapScriptError("unknown_op", "x"), { ok: false, code: 5, text: TEXT_OUTDATED });
  assert.deepEqual(mapScriptError("protocol_mismatch", "x"), { ok: false, code: 5, text: TEXT_OUTDATED });
  assert.deepEqual(mapScriptError("failed", "boom"), { ok: false, code: 1, text: "boom" });
});

test("SCRIPT_VERSION matches VERSION in protocol.py", () => {
  const py = readFileSync(new URL("../../remote-script/cmdAbl/protocol.py", import.meta.url), "utf8");
  assert.equal(parseScriptVersion(py), SCRIPT_VERSION);
});

test("installed script check: missing, old, current, unknown", () => {
  const home = "/h";
  const dir = "/h/Music/Ableton/User Library/Remote Scripts/cmdAbl";
  assert.equal(inspectInstalledScript("linux").status, "unknown");
  assert.equal(inspectInstalledScript("darwin", () => null, () => "absent", home).status, "missing");
  assert.equal(inspectInstalledScript("darwin", () => null, () => "unknown", home).status, "unknown"); // blocked, not missing
  const noProtocol = (_f: string) => null;
  assert.equal(inspectInstalledScript("darwin", noProtocol, () => "present", home).status, "outdated");
  const proto = (v: string) => (f: string) => (f === `${dir}/protocol.py` ? `VERSION = "${v}"\n` : null);
  assert.equal(inspectInstalledScript("darwin", proto(SCRIPT_VERSION), () => "present", home).status, "current");
  assert.equal(inspectInstalledScript("darwin", proto("0.0.9"), () => "present", home).status, "outdated");
  // Equality, not ordering: a script version above this extension's (a dev install from before the
  // 0.6.0 -> 0.1.0 reset) is "outdated" like any other difference, never "newer than shipped".
  assert.equal(inspectInstalledScript("darwin", proto("0.6.0"), () => "present", home).status, "outdated");
});

// Pins the reset value; update it together with VERSION in protocol.py on the next script change (0001 §3).
test("the script version is 0.1.2 (0001 §3 versioning rule)", () => {
  assert.equal(SCRIPT_VERSION, "0.1.2");
});
