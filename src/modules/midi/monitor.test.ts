import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTree } from "../../core/commandTree.js";
import { createFakeApi } from "../testPorts.js";
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
  const answer = (await page.routes.messages!()) as { opened: number; last: number; messages: Array<{ seq: number }> };
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
  const answer = (await fake.livePages[0]!.routes.messages!()) as { messages: Array<{ seq: number }> };
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
