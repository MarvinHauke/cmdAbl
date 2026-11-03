import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeBridge } from "./bridgeFake.js";
import { createBridgeClient, type Transport } from "./bridgeClient.js";
import { midiLast, midiListen } from "./bridgeOps.js";
import { createMidiMonitor, createMidiRoutes, latencyStats, parseControlList, readMidiEvent, SUMMARY_EVERY } from "./midiEvents.js";
import { fail, SCRIPT_VERSION } from "./bridgeProtocol.js";

const event = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, event: "midi", via: "udp", seq: 1, type: "cc", channel: 1, number: 21, value: 127, t: 1000, sent: 1001, ...over,
});

function logs() {
  const lines: string[] = [];
  const mk = (level: string) => (text: string) => void lines.push(`${level}: ${text}`);
  return { lines, log: { debug: mk("debug"), info: mk("info"), warn: mk("warn") } };
}

test("readMidiEvent checks every field", () => {
  assert.equal(readMidiEvent(event())?.number, 21);
  assert.equal(readMidiEvent(event({ t: "x" })), null);
  assert.equal(readMidiEvent(event({ via: 5 })), null);
  assert.equal(readMidiEvent(event({ value: NaN })), null);
});

test("latencyStats: min, median, max", () => {
  assert.equal(latencyStats([]), null);
  assert.deepEqual(latencyStats([5, 1, 3]), { n: 3, min: 1, median: 3, max: 5 });
  assert.deepEqual(latencyStats([4, 1, 2, 3]), { n: 4, min: 1, median: 2.5, max: 4 });
});

test("the monitor logs each event with its latency and a summary every SUMMARY_EVERY events per channel", () => {
  const { lines, log } = logs();
  const monitor = createMidiMonitor(log, () => 1010);
  monitor.handle(event());
  assert.match(lines[0]!, /^debug: cc ch1 #21 = 127 via udp seq 1 latency 10 ms \(held in the script 1 ms\)$/);
  for (let i = 2; i <= SUMMARY_EVERY; i++) monitor.handle(event({ seq: i }));
  assert.equal(lines.filter((l) => l.startsWith("info: latency via udp: n=50 min 10 median 10 max 10")).length, 1);
  monitor.handle(event({ via: "http", t: 1000 }), 1004);
  assert.deepEqual(Object.keys(monitor.summary()).sort(), ["http", "udp"]);
  assert.equal(monitor.summary().http?.median, 4);
});

test("the monitor ignores a broken event with a warning and never throws", () => {
  const { lines, log } = logs();
  const monitor = createMidiMonitor(log, () => 0);
  monitor.handle({ nonsense: true });
  assert.deepEqual(lines, ["warn: pushed event with a missing or wrong field ignored"]);
});

test("parseControlList", () => {
  assert.deepEqual(parseControlList("CC37,CC38/ch2,N60,PB"), [
    { type: "cc", number: 37 }, { type: "cc", number: 38, channel: 2 }, { type: "note", number: 60 }, { type: "pb" },
  ]);
  assert.deepEqual(parseControlList("cc"), [{ type: "cc" }]);
  for (const bad of ["", "CC128", "CC1/ch0", "CC1/ch17", "PB5", "X1", "CC1,,CC2", "CC1;"]) assert.equal(parseControlList(bad), null, bad);
});

test("the client hands pushed events to listeners, also with no request pending, and keeps replies apart", async () => {
  let deliver: (raw: string) => void = () => {};
  const transport: Transport = { send() {}, onMessage: (l) => void (deliver = l), close() {} };
  const client = createBridgeClient({ transport, installed: () => ({ status: "current", version: SCRIPT_VERSION }) });
  const seen: string[] = [];
  const off = client.onEvent!((e) => void seen.push(`${e.name}:${String(e.data.seq)}`));
  client.onEvent!(() => {
    throw new Error("broken listener");
  });
  deliver(JSON.stringify(event({ seq: 7 })));
  deliver(JSON.stringify({ v: 1, id: "late", ok: true, result: {} })); // a stray reply is not an event
  assert.deepEqual(seen, ["midi:7"]);
  off();
  deliver(JSON.stringify(event({ seq: 8 })));
  assert.deepEqual(seen, ["midi:7"]);
});

test("midiListen and midiLast speak the bridge ops and never throw", async () => {
  const bridge = createFakeBridge({
    ops: {
      midi_listen: (args) => ({ ok: true, value: { count: args.controls === "all" ? 4112 : 0 } }),
      midi_last: (args) => ({ ok: true, value: { last: 9, messages: [[8, "cc", 1, 21, 127, 1000.5], ["bad"], [9, "note_off", 2, 60, 0, 1002]], since: args.since } }),
    },
  });
  assert.deepEqual(await midiListen(bridge, "all"), { ok: true, value: { count: 4112 } });
  assert.deepEqual(bridge.calls[0], { op: "midi_listen", args: { controls: "all" }, changes: true, token: true });
  const last = await midiLast(bridge, 5);
  assert.ok(last.ok);
  assert.equal(last.value.last, 9);
  assert.deepEqual(last.value.messages.map((m) => m.seq), [8, 9]);
  assert.deepEqual(last.value.messages[0], { seq: 8, type: "cc", channel: 1, number: 21, value: 127, time: 1000.5 });
  const old = createFakeBridge({ ops: {} });
  const refused = await midiListen(old, "none");
  assert.equal(refused.ok, false);
  assert.deepEqual(await midiLast(createFakeBridge({ ops: { midi_last: () => fail(1, "x") } })), fail(1, "x"));
});

// --- routes ----------------------------------------------------------------------------------

type Req = { url: string; method: string; headers: Record<string, string>; body?: string };
function call(handler: ReturnType<typeof createMidiRoutes>, r: Req): Promise<{ handled: boolean; status?: number; body?: string }> {
  return new Promise((resolve) => {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const req = {
      url: r.url, method: r.method, headers: r.headers,
      on(name: string, fn: (...a: unknown[]) => void) { (listeners[name] ??= []).push(fn); return req; },
      destroy() {},
    };
    const res = {
      writeHead(status: number) { return { end: (body?: string) => resolve({ handled: true, status, body }) }; },
    };
    const handled = handler(req as never, res as never);
    if (!handled) return resolve({ handled: false });
    queueMicrotask(() => {
      if (r.body !== undefined) for (const fn of listeners.data ?? []) fn(Buffer.from(r.body));
      for (const fn of listeners.end ?? []) fn();
    });
  });
}

function routes(overrides: { eventToken?: string | null } = {}) {
  const { lines, log } = logs();
  const listened: unknown[] = [];
  const handler = createMidiRoutes({
    eventToken: () => (overrides.eventToken === undefined ? "e".repeat(32) : overrides.eventToken),
    controlToken: "c".repeat(64),
    monitor: createMidiMonitor(log, () => 1010),
    listen: async (controls) => {
      listened.push(controls);
      return "forwarding";
    },
    stats: () => "stats",
  });
  return { handler, lines, listened };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test("POST /midi-event: needs the bridge token, no browser page, a JSON object", async () => {
  const { handler, lines } = routes();
  const post = (headers: Record<string, string>, body = JSON.stringify(event())) => call(handler, { url: "/midi-event", method: "POST", headers, body });
  assert.equal((await post(auth("e".repeat(32)))).status, 200);
  assert.match(lines[0]!, /via udp/);
  assert.equal((await post({})).status, 401);
  assert.equal((await post(auth("x".repeat(32)))).status, 401);
  assert.equal((await post({ ...auth("e".repeat(32)), origin: "http://evil.example" })).status, 403);
  assert.equal((await post(auth("e".repeat(32)), "[1]")).status, 400);
  assert.equal((await post(auth("e".repeat(32)), "{nope")).status, 400);
  assert.equal((await call(handler, { url: "/midi-event", method: "GET", headers: auth("e".repeat(32)) })).status, 405);
  assert.equal((await routes({ eventToken: null }).handler({ url: "/midi-event", method: "POST", headers: auth("e".repeat(32)), on() { return this; } } as never, { writeHead: () => ({ end() {} }) } as never)), true);
});

test("POST /midi-listen: the development token, controls parsed, nothing else handled", async () => {
  const { handler, listened } = routes();
  const post = (q: string, token = "c".repeat(64)) => call(handler, { url: `/midi-listen?controls=${q}`, method: "POST", headers: auth(token), body: "" });
  assert.equal((await post("all")).status, 200);
  assert.equal((await post("CC1,N60")).status, 200);
  assert.deepEqual(listened, ["all", [{ type: "cc", number: 1 }, { type: "note", number: 60 }]]);
  assert.equal((await post("bogus")).status, 400);
  assert.equal((await post("all", "e".repeat(32))).status, 401); // the bridge token does not open this route
  assert.equal((await call(handler, { url: "/midi-stats", method: "GET", headers: auth("c".repeat(64)) })).body, "stats");
  assert.equal((await call(handler, { url: "/open", method: "GET", headers: {} })).handled, false);
});
