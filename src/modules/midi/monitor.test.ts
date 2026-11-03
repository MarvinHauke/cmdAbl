import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTree } from "../../core/commandTree.js";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";
import { monitorLines } from "./format.js";

const msg = (seq: number, type: string, channel: number, number: number, value: number) => ({ seq, type, channel, number, value, time: seq }) as never;

/** A real script gets its messages while the page is open; the fake keeps them from the start: the first `last` call must see none. */
function arriveAfterOpen(fake: { api: { midi: { last: (since?: number) => Promise<unknown> } } }): void {
  const real = fake.api.midi.last;
  let calls = 0;
  fake.api.midi.last = (async (since = 0) => (calls++ === 0 ? { ok: true, value: { last: 0, messages: [] } } : real(since))) as never;
}

const run = (fake: ReturnType<typeof createFakeApi>) =>
  fake.commands[0]!.children![0]!.run!({ path: ["midi", "monitor"], options: {}, args: [] } as never, undefined as never) as Promise<{ code: number; message?: string }>;

test("midi monitor lists the newest 20 messages, newest first", async () => {
  const messages = Array.from({ length: 25 }, (_, i) => msg(i + 1, "cc", 1, 37, i));
  const fake = createFakeApi({ dialogAnswer: "go", midiMessages: messages });
  activate(fake.api);
  arriveAfterOpen(fake as never);
  assert.deepEqual(validateTree(fake.commands as never), []);
  const r = await run(fake);
  const lines = r.message!.split("\n");
  assert.equal(lines.length, 20);
  assert.match(lines[0]!, /value 24$/);
  assert.match(lines[19]!, /value 5$/);
  assert.equal(fake.midiListens[0]!.monitor, true);
});

test("midi monitor: Esc shows nothing, no messages is exit 1", async () => {
  const esc = createFakeApi({ midiMessages: [msg(1, "cc", 1, 1, 1)] });
  activate(esc.api);
  assert.equal((await run(esc)).message, undefined);
  const none = createFakeApi({ dialogAnswer: "go" });
  activate(none.api);
  arriveAfterOpen(none as never);
  assert.equal((await run(none)).code, ExitCode.FAILURE);
});

test("monitorLines shows type, channel, number and value; pitch bend has no number", () => {
  assert.deepEqual(monitorLines([msg(1, "note_on", 2, 36, 100), msg(2, "pb", 1, 0, 8192)] as never), ["pb       ch1  value 8192", "note_on  ch2  number 36  value 100"]);
});
