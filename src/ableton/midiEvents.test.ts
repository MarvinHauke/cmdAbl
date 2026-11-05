import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeBridge } from "./bridgeFake.js";
import { createBridgeClient, isFromScript, type Transport } from "./bridgeClient.js";
import { midiLast, midiListen, onMidiEvent } from "./bridgeOps.js";
import { createMidiListenRoute, logMidiEvent, parseControlList } from "./midiEvents.js";
import { attachMidi, desiredControls, midiBlocked, onBlocked, readMidiEvent, resetMidiLink } from "./midiLink.js";
import { fail, SCRIPT_VERSION } from "./bridgeProtocol.js";

const pushed = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ v: 1, event: "midi", seq: 1, type: "cc", channel: 1, number: 21, value: 127, t: 1000, ...over });

test("readMidiEvent checks every field and the type", () => {
  assert.deepEqual(readMidiEvent(JSON.parse(pushed())), { seq: 1, type: "cc", channel: 1, number: 21, value: 127, time: 1000 });
  for (const bad of [{ t: "x" }, { type: "sysex" }, { type: 5 }, { value: NaN }, { seq: undefined }]) {
    assert.equal(readMidiEvent(JSON.parse(pushed(bad))), null, JSON.stringify(bad));
  }
});

test("readMidiEvent carries monitor only when it is true", () => {
  assert.equal(readMidiEvent(JSON.parse(pushed({ monitor: true })))?.monitor, true);
  assert.equal("monitor" in readMidiEvent(JSON.parse(pushed({ monitor: "yes" })))!, false);
  assert.equal("monitor" in readMidiEvent(JSON.parse(pushed()))!, false);
});

test("logMidiEvent writes one debug line with the latency", () => {
  const lines: string[] = [];
  logMidiEvent({ debug: (t) => void lines.push(t) }, { seq: 4, type: "note_off", channel: 2, number: 60, value: 0, time: 1000 }, 1001.25);
  assert.deepEqual(lines, ["note_off ch2 #60 = 0 seq 4 latency 1.3 ms"]);
  logMidiEvent({ debug: (t) => void lines.push(t) }, { seq: 5, type: "cc", channel: 1, number: 1, value: 1, time: 0, monitor: true }, 0);
  assert.equal(lines.length, 1, "monitor events are not logged one by one");
  logMidiEvent({ debug: () => { throw new Error("x"); } }, { seq: 1, type: "cc", channel: 1, number: 1, value: 1, time: 0 }, 0); // never throws
});

test("parseControlList", () => {
  assert.deepEqual(parseControlList("CC37,CC38/ch2,N60,PB"), [
    { type: "cc", number: 37 }, { type: "cc", number: 38, channel: 2 }, { type: "note", number: 60 }, { type: "pb" },
  ]);
  assert.deepEqual(parseControlList("cc"), [{ type: "cc" }]);
  for (const bad of ["", "CC128", "CC1/ch0", "CC1/ch17", "PB5", "X1", "CC1,,CC2", "CC1;"]) assert.equal(parseControlList(bad), null, bad);
});

test("only datagrams from 127.0.0.1:27185 count as the script", () => {
  assert.equal(isFromScript("127.0.0.1", 27185), true);
  assert.equal(isFromScript("127.0.0.1", 27186), false);
  assert.equal(isFromScript("192.168.0.2", 27185), false);
});

function fakeTransport() {
  const sent: string[] = [];
  let deliver: (raw: string) => void = () => {};
  const transport: Transport = { send: (d, done) => (sent.push(d), done(null)), onMessage: (l) => void (deliver = l), close() {} };
  return { transport, sent, deliver: (raw: string) => deliver(raw) };
}
const client = (transport: Transport) => createBridgeClient({ transport, installed: () => ({ status: "current", version: SCRIPT_VERSION }), timeoutMs: 20 });

test("pushed MIDI events reach onMidiEvent, also with no request pending; replies are not events", () => {
  resetMidiLink();
  const t = fakeTransport();
  attachMidi(client(t.transport));
  const seen: string[] = [];
  const off = onMidiEvent((e) => void seen.push(`${e.type}:${e.number}`));
  onMidiEvent(() => { throw new Error("broken listener"); });
  t.deliver(pushed({ number: 7 }));
  t.deliver(JSON.stringify({ v: 1, id: "late", ok: true, result: {} }));
  t.deliver(pushed({ type: "bogus" }));
  t.deliver(JSON.stringify({ v: 1, event: "other", type: "cc", seq: 1, channel: 1, number: 1, value: 1, t: 1 }));
  assert.deepEqual(seen, ["cc:7"]);
  off();
  t.deliver(pushed());
  assert.deepEqual(seen, ["cc:7"]);
});

test("a recreated bridge client keeps delivering to the same listeners", () => {
  resetMidiLink();
  const seen: number[] = [];
  onMidiEvent((e) => void seen.push(e.seq));
  const first = fakeTransport();
  const c1 = client(first.transport);
  attachMidi(c1);
  c1.close();
  const second = fakeTransport();
  attachMidi(client(second.transport));
  second.deliver(pushed({ seq: 9 }));
  assert.deepEqual(seen, [9]);
});

test("when the script restarts (boot id changes) the last listen is sent again", async () => {
  resetMidiLink();
  let boot = "aaaa";
  const listens: Array<Record<string, unknown>> = [];
  let deliver: (raw: string) => void = () => {};
  const transport: Transport = {
    send(data, done) {
      const req = JSON.parse(data) as { id: string; op: string; args: Record<string, unknown> };
      let result: Record<string, unknown> = {};
      if (req.op === "hello") result = { script: SCRIPT_VERSION, v: 1, ops: ["hello", "midi_listen", "midi_last"] };
      if (req.op === "midi_listen") (listens.push(req.args), (result = { count: 1, monitor: false }));
      if (req.op === "midi_last") result = { last: 0, messages: [] };
      queueMicrotask(() => deliver(JSON.stringify({ v: 1, id: req.id, ok: true, result, boot })));
      done(null);
    },
    onMessage: (l) => void (deliver = l),
    close() {},
  };
  const token = { get: () => ({ ok: true as const, value: "t".repeat(32) }), forget() {} };
  const c = createBridgeClient({ transport, installed: () => ({ status: "current", version: SCRIPT_VERSION }), token, timeoutMs: 200 });
  attachMidi(c);
  assert.equal((await midiListen(c, [{ type: "cc", number: 1 }])).ok, true);
  await new Promise((r) => setTimeout(r, 5));
  const afterFirst = listens.length;
  assert.equal(afterFirst, 1, "the listen in flight covers the first contact: no second one");
  await c.request("midi_last", {});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(listens.length, afterFirst, "same boot id: nothing is re-sent");
  boot = "bbbb"; // the script was reloaded
  await c.request("midi_last", {});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(listens.length, afterFirst + 1);
  assert.deepEqual(listens[listens.length - 1]!.controls, [{ type: "cc", number: 1 }]);
});

test("midiListen sends controls (and monitor only when asked), remembers controls, and never throws", async () => {
  resetMidiLink();
  const bridge = createFakeBridge({ ops: { midi_listen: (args) => ({ ok: true, value: { count: args.monitor ? 4112 : 3, monitor: args.monitor === true } }) } });
  assert.deepEqual(await midiListen(bridge, "none"), { ok: true, value: { count: 3, monitor: false, blocked: null } });
  assert.deepEqual(bridge.calls[0], { op: "midi_listen", args: { controls: "none" }, changes: true, token: true });
  const mon = await midiListen(bridge, [{ type: "note" }], { monitor: true, seconds: 10 });
  assert.deepEqual(mon, { ok: true, value: { count: 4112, monitor: true, blocked: null } });
  assert.deepEqual(bridge.calls[1]!.args, { controls: [{ type: "note" }], monitor: true, seconds: 10 });
  assert.deepEqual(desiredControls(), [{ type: "note" }]);
  const refused = await midiListen(createFakeBridge({ ops: {} }), "none");
  assert.equal(refused.ok, false);
  const odd = await midiListen(createFakeBridge({ ops: { midi_listen: () => ({ ok: true, value: {} }) } }), "none");
  assert.equal(odd.ok, false);
});

test("midiLast reads rows, skips bad ones, fails soft", async () => {
  const bridge = createFakeBridge({
    ops: { midi_last: () => ({ ok: true, value: { last: 9, messages: [[8, "cc", 1, 21, 127, 1000.5], ["bad"], [9, "note_off", 2, 60, 0, 1002]] } }) },
  });
  const last = await midiLast(bridge, 5);
  assert.ok(last.ok);
  assert.deepEqual(last.value.messages.map((m) => m.seq), [8, 9]);
  assert.deepEqual(last.value.messages[0], { seq: 8, type: "cc", channel: 1, number: 21, value: 127, time: 1000.5 });
  assert.deepEqual(await midiLast(createFakeBridge({ ops: { midi_last: () => fail(1, "x") } })), fail(1, "x"));
});

type Req = { url: string; method: string; headers: Record<string, string> };
function call(handler: ReturnType<typeof createMidiListenRoute>, r: Req): Promise<{ handled: boolean; status?: number; body?: string }> {
  return new Promise((resolve) => {
    const res = { writeHead: (status: number) => ({ end: (body?: string) => resolve({ handled: true, status, body }) }) };
    if (!handler(r as never, res as never)) resolve({ handled: false });
  });
}
const auth = { authorization: `Bearer ${"c".repeat(64)}` };

test("POST /midi-listen: the development token, controls parsed, monitor flag, nothing else handled", async () => {
  const listened: unknown[] = [];
  const handler = createMidiListenRoute({ token: "c".repeat(64), listen: async (c, m) => (listened.push([c, m]), "ok") });
  const post = (q: string, headers: Record<string, string> = auth) => call(handler, { url: `/midi-listen?controls=${q}`, method: "POST", headers });
  assert.equal((await post("all")).status, 200);
  assert.equal((await post("CC1,N60&monitor=1")).status, 200);
  assert.deepEqual(listened, [["all", false], [[{ type: "cc", number: 1 }, { type: "note", number: 60 }], true]]);
  assert.equal((await post("bogus")).status, 400);
  assert.equal((await post("all", { authorization: "Bearer nope" })).status, 401);
  assert.equal((await post("all", {})).status, 401);
  assert.equal((await post("all", { ...auth, origin: "http://evil.example" })).status, 403);
  assert.equal((await call(handler, { url: "/midi-listen?controls=all", method: "GET", headers: auth })).status, 405);
  assert.equal((await call(handler, { url: "/open", method: "GET", headers: {} })).handled, false);
});

function scriptWith(bootRef: { boot: string }) {
  const listens: Array<Record<string, unknown>> = [];
  let deliver: (raw: string) => void = () => {};
  const transport: Transport = {
    send(data, done) {
      const req = JSON.parse(data) as { id: string; op: string; args: Record<string, unknown> };
      let result: Record<string, unknown> = {};
      if (req.op === "hello") result = { script: SCRIPT_VERSION, v: 1, ops: ["hello", "midi_listen", "midi_last"] };
      if (req.op === "midi_listen") (listens.push(req.args), (result = { count: 1, monitor: req.args.monitor === true }));
      if (req.op === "midi_last") result = { last: 0, messages: [] };
      queueMicrotask(() => deliver(JSON.stringify({ v: 1, id: req.id, ok: true, result, boot: bootRef.boot })));
      done(null);
    },
    onMessage: (l) => void (deliver = l),
    close() {},
  };
  const token = { get: () => ({ ok: true as const, value: "t".repeat(32) }), forget() {} };
  const c = createBridgeClient({ transport, installed: () => ({ status: "current", version: SCRIPT_VERSION }), token, timeoutMs: 200 });
  attachMidi(c);
  return { c, listens };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test("a monitor listen as first contact is not cancelled by the restart re-send", async () => {
  resetMidiLink();
  const { c, listens } = scriptWith({ boot: "aaaa" });
  await midiListen(c, [{ type: "cc", number: 1 }], { monitor: true, seconds: 20 });
  await settle();
  assert.equal(listens.length, 1);
  assert.equal(listens[listens.length - 1]!.monitor, true);
});

test("a monitor listen as the first request after a script restart is not cancelled either", async () => {
  resetMidiLink();
  const boot = { boot: "aaaa" };
  const { c, listens } = scriptWith(boot);
  await midiListen(c, "none");
  await settle();
  boot.boot = "bbbb"; // reloaded
  await midiListen(c, [{ type: "note" }], { monitor: true, seconds: 20 });
  await settle();
  assert.equal(listens[listens.length - 1]!.monitor, true, "the last listen the script saw keeps the monitor");
  assert.equal(listens.length, 2);
});

test("a restart during an open monitor window re-sends it with the time that is left; an ended window is not reopened", async () => {
  resetMidiLink();
  const boot = { boot: "aaaa" };
  const { c, listens } = scriptWith(boot);
  await midiListen(c, [{ type: "cc" }], { monitor: true, seconds: 20 });
  await settle();
  boot.boot = "bbbb";
  await c.request("midi_last", {});
  await settle();
  const again = listens[listens.length - 1]!;
  assert.equal(again.monitor, true);
  assert.ok((again.seconds as number) >= 19 && (again.seconds as number) <= 20);
  await midiListen(c, [{ type: "cc" }]); // a listen without monitor ends the window
  boot.boot = "cccc";
  await c.request("midi_last", {});
  await settle();
  assert.equal(listens[listens.length - 1]!.monitor, undefined);
});

test("status:false is sent only when asked, and a restart keeps it", async () => {
  resetMidiLink();
  const boot = { boot: "aaaa" };
  const { c, listens } = scriptWith(boot);
  await midiListen(c, "none", { monitor: true, seconds: 20 });
  assert.equal(listens[0]!.status, undefined);
  await midiListen(c, "none", { monitor: true, seconds: 20, status: false });
  assert.equal(listens[1]!.status, false);
  boot.boot = "bbbb";
  await c.request("midi_last", {});
  await settle();
  assert.equal(listens[listens.length - 1]!.status, false);
});

test("a refused listen does not become the re-send target", async () => {
  resetMidiLink();
  const bridge = createFakeBridge({ ops: { midi_listen: () => fail(5, "no") } });
  await midiListen(bridge, "all");
  assert.equal(desiredControls(), null);
});

test("the blocked set: pushed midi_blocked events and the listen reply feed onBlocked/midiBlocked, once per change", async () => {
  resetMidiLink();
  const t = fakeTransport();
  attachMidi(client(t.transport));
  const seen: Array<string[] | null> = [];
  onBlocked((b) => void seen.push(b));
  assert.equal(midiBlocked(), null, "unknown until the script reports");
  t.deliver(JSON.stringify({ v: 1, event: "midi_blocked", blocked: ["CC51/ch1"] }));
  t.deliver(JSON.stringify({ v: 1, event: "midi_blocked", blocked: ["CC51/ch1"] })); // same set: no second call
  assert.deepEqual(midiBlocked(), ["CC51/ch1"]);
  t.deliver(JSON.stringify({ v: 1, event: "midi_blocked", blocked: null }));
  t.deliver(JSON.stringify({ v: 1, event: "midi_blocked", blocked: "CC1" })); // malformed: ignored
  t.deliver(JSON.stringify({ v: 1, event: "midi_blocked", blocked: [] }));
  assert.deepEqual(seen, [["CC51/ch1"], null, []]);
  const bridge = createFakeBridge({ ops: { midi_listen: () => ({ ok: true, value: { count: 1, monitor: false, blocked: ["N60/ch2"] } }) } });
  const r = await midiListen(bridge, [{ type: "note" }]);
  assert.ok(r.ok && r.value.blocked?.[0] === "N60/ch2");
  assert.deepEqual(midiBlocked(), ["N60/ch2"]);
});
