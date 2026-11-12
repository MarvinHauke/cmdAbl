import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { validateTree } from "../../core/command/commandTree.js";
import { createFakeApi } from "../shared/testPorts.js";
import { registerMidi } from "./command.js";

const TEMPLATE = "<script>const CAPTURE = /*CAPTURE_PLACEHOLDER*/null; const LIVE = /*LIVE_PLACEHOLDER*/null;</script>";
const activate = (api: Parameters<typeof registerMidi>[0]) => registerMidi(api, TEMPLATE);

const msg = (seq: number, type: string, channel: number, number: number, value: number) => ({ seq, type, channel, number, value, time: seq }) as never;

/** A real script gets its messages while the page is open; the fake keeps them from the start: the first `last` call must see none. */
function arriveAfterOpen(fake: { api: { midi: { last: (since?: number) => Promise<unknown> } } }): void {
  const real = fake.api.midi.last;
  let calls = 0;
  fake.api.midi.last = (async (since = 0) => (calls++ === 0 ? { ok: true, value: { last: 0, messages: [] } } : real(since))) as never;
}

/** Ask a waiting route the way core's server does (`since` = what the page saw last). */
const ask = (routes: { messages?: unknown }, since: number | null = null) =>
  (routes.messages as { wait: (since: number | null, cancel: { cancelled: boolean; onCancel(cb: () => void): void }) => Promise<unknown> }).wait(since, { cancelled: false, onCancel() {} });

const run = (fake: ReturnType<typeof createFakeApi>) =>
  fake.commands[0]!.children![0]!.run!({ path: ["midi", "monitor"], options: {}, args: [] } as never, undefined as never) as Promise<{ code: number; message?: string }>;

test("midi monitor closes quietly: no message, one log line, the window ends", async () => {
  const fake = createFakeApi({ dialogAnswer: "go", midiMessages: [msg(1, "cc", 1, 37, 5), msg(2, "cc", 1, 38, 6)] });
  activate(fake.api);
  arriveAfterOpen(fake as never);
  assert.deepEqual(validateTree(fake.commands as never), []);
  const r = (await fake.commands[0]!.children![0]!.run!({ path: ["midi", "monitor"], options: {}, args: [] } as never, undefined as never)) as { code: number; message?: string; log?: string[] };
  assert.equal(r.code, 0);
  assert.equal(r.message, undefined);
  assert.deepEqual(r.log, ["midi monitor: 2 message(s) seen"]);
  assert.equal(fake.midiListens[0]!.monitor, true);
  assert.equal(fake.midiListens.at(-1)!.controls, "none");
});

test("midi monitor: Esc and an empty window are quiet too", async () => {
  const esc = createFakeApi({ midiMessages: [msg(1, "cc", 1, 1, 1)] });
  activate(esc.api);
  assert.equal((await run(esc)).message, undefined);
  const none = createFakeApi({ dialogAnswer: "go" });
  activate(none.api);
  assert.equal((await run(none)).message, undefined);
});

test("midi monitor opens a live page whose messages route gives the newest 20 since the open, oldest first", async () => {
  const messages = Array.from({ length: 25 }, (_, i) => msg(i + 1, "cc", 1, 37, i));
  const fake = createFakeApi({ dialogAnswer: "go", midiMessages: messages });
  activate(fake.api);
  arriveAfterOpen(fake as never);
  await run(fake);
  const page = fake.livePages[0]!;
  assert.equal(page.name, "midi-monitor");
  assert.match(page.html, /"mode":"monitor"/);
  const answer = (await ask(page.routes)) as { opened: number; last: number; messages: Array<{ seq: number }> };
  assert.equal(answer.messages.length, 20);
  assert.equal(answer.messages[0]!.seq, 6);
  assert.equal(answer.messages.at(-1)!.seq, 25);
  assert.equal(answer.last, 25);
  assert.ok(answer.opened > 0);
});

test("the messages route answers at once from its cache even when the bridge is slow", async () => {
  const fake = createFakeApi({ dialogAnswer: "go", midiMessages: [msg(1, "cc", 1, 37, 5)] });
  activate(fake.api);
  arriveAfterOpen(fake as never);
  const fast = fake.api.midi.last;
  let slow = false;
  fake.api.midi.last = (async (since?: number) => {
    if (slow) await new Promise((r) => setTimeout(r, 200));
    return fast(since);
  }) as never;
  await run(fake);
  slow = true;
  const t = performance.now();
  const answer = (await ask(fake.livePages[0]!.routes)) as { messages: Array<{ seq: number }> };
  assert.ok(performance.now() - t < 50, "answered from the cache");
  assert.equal(answer.messages[0]!.seq, 1);
});

test("midi monitor without a live view (the page answers \"list\") shows the newest 20 messages, newest first", async () => {
  const messages = Array.from({ length: 25 }, (_, i) => msg(i + 1, "cc", 1, 37, i));
  const fake = createFakeApi({ dialogAnswer: "list", midiMessages: messages });
  activate(fake.api);
  arriveAfterOpen(fake as never);
  const r = await run(fake);
  const lines = r.message!.split("\n");
  assert.equal(lines.length, 20);
  assert.match(lines[0]!, /value 24$/);
  assert.match(lines[19]!, /value 5$/);
});

test("midi monitor: an empty window without a live view is exit 1 with a hint", async () => {
  const fake = createFakeApi({ dialogAnswer: "list" });
  activate(fake.api);
  const r = await run(fake);
  assert.equal(r.code, 1);
  assert.match(r.message!, /nothing arrived/);
});

test("midi monitor: Esc is quiet even without a live view", async () => {
  const fake = createFakeApi({ midiMessages: [msg(1, "cc", 1, 1, 1)] });
  activate(fake.api);
  assert.equal((await run(fake)).message, undefined);
});

test("while the page is open, monitor events feed the route cache", { timeout: 5000 }, async () => {
  const fake = createFakeApi({});
  activate(fake.api);
  let release: (v: string) => void = () => {};
  fake.api.ui.livePage = (async (name: string, html: string, w: number, h: number, routes: never) => {
    fake.livePages.push({ name, html, width: w, height: h, routes });
    return new Promise<string>((r) => (release = r));
  }) as never;
  const done = run(fake);
  await new Promise((r) => setTimeout(r, 10));
  type Answer = { messages: Array<{ seq: number; value: number }>; last: number; blocked: string[] | null };
  assert.equal(((await ask(fake.livePages[0]!.routes)) as Answer).messages.length, 0);
  const ev = (seq: number, value: number, monitor?: true) => ({ seq, type: "cc", channel: 1, number: 37, value, time: seq, ...(monitor ? { monitor } : {}) }) as never;
  for (const l of fake.eventListeners) l(ev(1, 10, true));
  for (const l of fake.eventListeners) l(ev(2, 99)); // a listened control, not a monitor event: ignored
  for (const l of fake.eventListeners) l(ev(3, 20, true));
  assert.deepEqual((((await ask(fake.livePages[0]!.routes)) as Answer).messages).map((m) => m.value), [10, 20]);
  release("go");
  await done;
  assert.equal(fake.eventListeners.length, 0); // unsubscribed
});

test("the messages route waits for a newer message (long polling) and answers at once for the first request", { timeout: 5000 }, async () => {
  const fake = createFakeApi({});
  activate(fake.api);
  let release: (v: string) => void = () => {};
  fake.api.ui.livePage = (async (name: string, html: string, w: number, h: number, routes: never) => {
    fake.livePages.push({ name, html, width: w, height: h, routes });
    return new Promise<string>((r) => (release = r));
  }) as never;
  const done = run(fake);
  await new Promise((r) => setTimeout(r, 10));
  const routes = fake.livePages[0]!.routes;
  type Answer = { last: number; messages: Array<{ seq: number }>; blocked: string[] | null };
  try {
    for (const l of fake.eventListeners) l({ seq: 5, type: "cc", channel: 1, number: 5, value: 1, time: 5, monitor: true } as never);
    const first = (await ask(routes)) as Answer; // the first request answers at once
    assert.equal(first.last, 5);
    let answered: Answer | undefined;
    const waiting = ask(routes, first.last).then((a) => (answered = a as Answer));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(answered, undefined, "holds while nothing newer arrived");
    for (const l of fake.eventListeners) l({ seq: 7, type: "cc", channel: 1, number: 5, value: 1, time: 7, monitor: true } as never);
    await waiting;
    assert.deepEqual(answered!.messages.map((m) => m.seq), [5, 7]);
    assert.equal(answered!.last, 7);
  } finally {
    release("go");
    await done;
  }
});

test("the route answer carries the controls Live refused to forward (null = unknown); a change of that list wakes a waiting request", { timeout: 5000 }, async () => {
  const fake = createFakeApi({});
  fake.midiBlocked = ["CC51/ch1"];
  activate(fake.api);
  let release: (v: string) => void = () => {};
  fake.api.ui.livePage = (async (name: string, html: string, w: number, h: number, routes: never) => {
    fake.livePages.push({ name, html, width: w, height: h, routes });
    return new Promise<string>((r) => (release = r));
  }) as never;
  const done = run(fake);
  await new Promise((r) => setTimeout(r, 10));
  const routes = fake.livePages[0]!.routes;
  try {
    for (const l of fake.eventListeners) l({ seq: 5, type: "cc", channel: 1, number: 5, value: 1, time: 5, monitor: true } as never);
    const first = (await ask(routes)) as { last: number; blocked: string[] | null };
    assert.deepEqual(first.blocked, ["CC51/ch1"]);
    let woke: { blocked: string[] | null } | undefined;
    const waiting = ask(routes, first.last).then((a) => (woke = a as never));
    await new Promise((r) => setTimeout(r, 10));
    fake.midiBlocked = ["CC51/ch1", "N60/ch2"];
    for (const l of fake.blockedListeners) l(fake.midiBlocked);
    await waiting;
    assert.deepEqual(woke!.blocked, ["CC51/ch1", "N60/ch2"]);
  } finally {
    release("go");
    await done;
  }
});

after(() => mock.timers.reset());

// ── renewal of the listening window while the page is open ──────────────────────────────────────────
/** Open the monitor with a page that stays open until `close()`; the timers are fake. Returns helpers. */
async function openPending(fail?: (n: number) => boolean) {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fake = createFakeApi({});
  activate(fake.api);
  let close: (answer: string | null) => void = () => {};
  fake.api.ui.livePage = (async (name: string, html: string, width: number, height: number, routes: never) => {
    fake.livePages.push({ name, html, width, height, routes });
    return new Promise<string | null>((resolve) => (close = resolve));
  }) as never;
  let listens = 0;
  const realListen = fake.api.midi.listen;
  fake.api.midi.listen = (async (controls: never, options: never) => {
    const n = listens++;
    if (n > 0 && (options as { monitor?: boolean } | undefined)?.monitor && fail?.(n)) return { ok: false, code: 5, text: "Remote Script did not answer" };
    return (realListen as never as (c: unknown, o: unknown) => Promise<unknown>)(controls, options);
  }) as never;
  const done = run(fake);
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  await flush();
  const tick = async (ms: number) => { mock.timers.tick(ms); await flush(); };
  const status = async () => ((await ask(fake.livePages[0]!.routes)) as { status: { listening: boolean; stoppedReason?: string } }).status;
  return { fake, close: async (a: string | null) => { close(a); await flush(); return done; }, tick, status, monitorListens: () => fake.midiListens.filter((l) => l.monitor).length };
}

test("monitor window is renewed every 20 s while the page is open and ends when it closes", async () => {
  const t = await openPending();
  try {
    assert.equal(t.monitorListens(), 1);
    assert.equal((await t.status()).listening, true);
    await t.tick(20_000);
    assert.equal(t.monitorListens(), 2);
    await t.tick(20_000);
    assert.equal(t.monitorListens(), 3);
    const r = await t.close("go");
    assert.equal(r.code, 0);
    assert.equal(t.fake.midiListens.at(-1)!.controls, "none");
    const after = t.monitorListens();
    await t.tick(60_000);
    assert.equal(t.monitorListens(), after, "no renewals after close");
  } finally {
    mock.timers.reset();
  }
});

test("a failed renewal is retried once; a second failure says stopped, logs one warning and stops renewing", async () => {
  const t = await openPending((n) => n >= 1);
  try {
    await t.tick(20_000);
    assert.equal((await t.status()).listening, true, "still retrying");
    await t.tick(1_000);
    const status = await t.status();
    assert.equal(status.listening, false);
    assert.match(status.stoppedReason!, /Listening stopped: Remote Script did not answer/);
    assert.equal(t.fake.logged.filter((l) => l.level === "warn").length, 1);
    const count = t.monitorListens();
    await t.tick(60_000);
    assert.equal(t.monitorListens(), count, "no more renewals once stopped");
    await t.close("go");
  } finally {
    mock.timers.reset();
  }
});

test("a renewal that fails once and then works keeps listening", async () => {
  const t = await openPending((n) => n === 1);
  try {
    await t.tick(21_000);
    assert.equal((await t.status()).listening, true);
    assert.equal(t.fake.logged.filter((l) => l.level === "warn").length, 0);
    await t.close("go");
  } finally {
    mock.timers.reset();
  }
});
