import { test } from "node:test";
import assert from "node:assert/strict";
import { createBridgeClient, type Transport } from "./bridgeClient.js";
import { createFakeBridge } from "./bridgeFake.js";
import { TEXT_NOT_INSTALLED, TEXT_NOT_RUNNING, TEXT_OUTDATED, TEXT_STALE } from "./bridgeProtocol.js";
import type { InstalledScript } from "./installedScript.js";

/** A transport driven by the test; `answer` decides what the "script" replies. */
function harness(answer: (req: { id: string; op: string; args: unknown }) => string | null, installed: InstalledScript = { status: "current", version: "0.1.0" }) {
  let listener: (d: string) => void = () => {};
  const timers: Array<() => void> = [];
  const sent: string[] = [];
  const transport: Transport = {
    send(data, done) {
      sent.push(data);
      const reply = answer(JSON.parse(data));
      done(null);
      if (reply !== null) queueMicrotask(() => listener(reply));
    },
    onMessage(l) { listener = l; },
    close() {},
  };
  const bridge = createBridgeClient({
    transport,
    installed: () => installed,
    setTimer: (fn) => { timers.push(fn); return timers.length - 1; },
    clearTimer: () => {},
  });
  return { bridge, sent, fire: () => timers.splice(0).forEach((f) => f()), push: (d: string) => listener(d) };
}

const okReply = (id: string, result: object) => JSON.stringify({ v: 1, id, ok: true, result });
const errReply = (id: string, code: string, text = "t") => JSON.stringify({ v: 1, id, ok: false, error: { code, text } });
const helloOk = (id: string, ops: string[] = ["hello", "select"]) => okReply(id, { script: "0.1.0", v: 1, ops });

test("hello caches the state; state() never sends", async () => {
  const h = harness((r) => helloOk(r.id));
  assert.equal(h.bridge.state(), "unknown");
  assert.equal(h.sent.length, 0);
  const a = await h.bridge.available();
  assert.equal(a.ok, true);
  assert.equal(h.bridge.state(), "available");
  await h.bridge.available();
  assert.equal(h.sent.length, 1);
});

test("no hello reply → code 5 with the text for the installed state", async () => {
  for (const [installed, text] of [
    [{ status: "current", version: "0.1.0" }, TEXT_NOT_RUNNING],
    [{ status: "missing" }, TEXT_NOT_INSTALLED],
    [{ status: "outdated", version: null }, TEXT_OUTDATED],
  ] as Array<[InstalledScript, string]>) {
    const h = harness(() => null, installed);
    const p = h.bridge.available();
    await Promise.resolve();
    h.fire();
    assert.deepEqual(await p, { ok: false, code: 5, text });
    assert.equal(h.bridge.state(), "unavailable");
  }
});

test("a request returns the result; script errors map to exit codes", async () => {
  const h = harness((r) => (r.op === "hello" ? helloOk(r.id) : r.args && (r.args as any).bad ? errReply(r.id, "stale") : okReply(r.id, { name: "Kick" })));
  assert.deepEqual(await h.bridge.request("select", { x: 1 }), { ok: true, value: { name: "Kick" } });
  assert.deepEqual(await h.bridge.request("select", { bad: true }), { ok: false, code: 1, text: TEXT_STALE });
});

test("an op the script lacks → code 5 outdated, nothing sent", async () => {
  const h = harness((r) => helloOk(r.id, ["hello"]));
  const r = await h.bridge.request("select", {});
  assert.deepEqual(r, { ok: false, code: 5, text: TEXT_OUTDATED });
  assert.equal(h.sent.length, 1);
});

test("timeout after hello: code 1, a write says the end state is unknown, hello is asked again", async () => {
  const h = harness((r) => (r.op === "hello" ? helloOk(r.id) : null));
  assert.equal((await h.bridge.available()).ok, true);
  const p = h.bridge.request("select", {}, { changes: true });
  await new Promise((r) => setImmediate(r));
  h.fire();
  const r = await p;
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 1);
    assert.match(r.text, /unknown/);
  }
  assert.equal(h.bridge.state(), "unknown");
});

test("malformed reply, late reply and unknown id never throw", async () => {
  const h = harness((r) => (r.op === "hello" ? helloOk(r.id) : '{"v":1,"id":"' + r.id + '","ok":true}'));
  const r = await h.bridge.request("select", {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 1);
  assert.doesNotThrow(() => h.push("garbage"));
  assert.doesNotThrow(() => h.push(okReply("nobody", {})));
});

test("protocol version mismatch in hello → code 5", async () => {
  const h = harness((r) => okReply(r.id, { script: "9.9.9", v: 2, ops: ["hello"] }));
  const r = await h.bridge.available();
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 5);
});

test("a throwing installed() does not wedge the client; request works detached", async () => {
  let listener: (d: string) => void = () => {};
  const timers: Array<() => void> = [];
  let hellos = 0;
  const transport: Transport = {
    send(data, done) {
      const r = JSON.parse(data);
      done(null);
      if (r.op === "hello" && ++hellos === 1) return; // first hello: no answer
      queueMicrotask(() => listener(okReply(r.id, r.op === "hello" ? { script: "0.1.0", v: 1, ops: ["hello", "select"] } : { n: 1 })));
    },
    onMessage(l) { listener = l; },
    close() {},
  };
  const bridge = createBridgeClient({
    transport,
    installed: () => { throw new Error("sandbox"); },
    setTimer: (fn) => { timers.push(fn); return 0; },
    clearTimer: () => {},
  });
  const first = bridge.available();
  await Promise.resolve();
  timers.splice(0).forEach((f) => f());
  assert.deepEqual(await first, { ok: false, code: 5, text: TEXT_NOT_RUNNING });
  const { request } = bridge; // detached, as through a port
  assert.deepEqual(await request("select", {}), { ok: true, value: { n: 1 } });
});

test("a send error is not a timeout: nothing changed, cache kept", async () => {
  let n = 0;
  let listener: (d: string) => void = () => {};
  const transport: Transport = {
    send(data, done) {
      const r = JSON.parse(data);
      if (r.op !== "hello") return done(new Error("EPERM"));
      done(null);
      queueMicrotask(() => listener(okReply(r.id, { script: "0.1.0", v: 1, ops: ["hello", "select"] })));
    },
    onMessage(l) { listener = l; },
    close() { n++; },
  };
  const bridge = createBridgeClient({ transport, installed: () => ({ status: "current", version: "0.1.0" }) });
  const r = await bridge.request("select", {}, { changes: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.text, /nothing changed/);
  assert.equal(bridge.state(), "available");
  bridge.close();
  assert.equal(n, 1);
});

test("fake bridge: scripted ops, call record, unavailable", async () => {
  const fake = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "A" } }) } });
  assert.deepEqual(await fake.request("select", { r: 1 }, { changes: true }), { ok: true, value: { name: "A" } });
  assert.deepEqual(fake.calls, [{ op: "select", args: { r: 1 }, changes: true }]);
  assert.equal((await fake.request("nope")).ok, false);
  const down = createFakeBridge({ running: false });
  assert.deepEqual((await down.available()).ok, false);
  assert.equal(down.state(), "unavailable");
});
