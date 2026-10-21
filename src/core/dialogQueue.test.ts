import { test } from "node:test";
import assert from "node:assert/strict";
import { createDialogQueue } from "./dialogQueue.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

test("dialogQueue: a second dialog opens only after the first closed", async () => {
  const lines: string[] = [];
  const q = createDialogQueue((l) => lines.push(l), () => 0);
  const first = deferred<string>();
  const opened: string[] = [];
  const a = q.run("palette", () => (opened.push("palette"), first.promise));
  const b = q.run("message", async () => (opened.push("message"), "x"));
  await tick();
  assert.deepEqual(opened, ["palette"]);
  assert.equal(q.describe(), "palette (open), message (queued)");
  first.resolve("");
  assert.equal(await a, "");
  assert.equal(await b, "x");
  assert.deepEqual(opened, ["palette", "message"]);
  assert.equal(q.describe(), null);
  assert.deepEqual(lines, [
    "cmdAbl [dialog] info: open: palette",
    "cmdAbl [dialog] info: closed: palette (no value, open for 0 ms)",
    "cmdAbl [dialog] info: open: message (0 ms after the previous dialog closed)",
    "cmdAbl [dialog] info: closed: message (returned a value, open for 0 ms)",
  ]);
});

test("dialogQueue: a rejected dialog reaches its caller but does not block the queue", async () => {
  const lines: string[] = [];
  const q = createDialogQueue((l) => lines.push(l), () => 0);
  const failing = q.run("palette", () => Promise.reject(new Error("boom")));
  const after = q.run("message", async () => "ok");
  await assert.rejects(failing, /boom/);
  assert.equal(await after, "ok");
  assert.equal(q.describe(), null);
  assert.ok(lines.includes("cmdAbl [dialog] warn: failed: palette (boom, open for 0 ms)"));
});

test("dialogQueue: a task that throws synchronously is a rejection too", async () => {
  const q = createDialogQueue(() => {});
  await assert.rejects(q.run("pick", () => { throw new Error("sync"); }), /sync/);
  assert.equal(await q.run("message", async () => "ok"), "ok");
});

test("dialogQueue: onIdle fires once the last open or queued dialog is gone", async () => {
  const q = createDialogQueue(() => {});
  let idle = 0;
  q.onIdle(() => idle++);
  const a = q.run("palette", async () => "x");
  const b = q.run("message", async () => "y");
  await Promise.all([a, b]);
  assert.equal(idle, 1);
  await q.run("message", async () => "z");
  assert.equal(idle, 2);
});

test("dialogQueue: idle fires before the awaiting caller resumes", async () => {
  const q = createDialogQueue(() => {});
  const order: string[] = [];
  q.onIdle(() => order.push("idle"));
  await q.run("palette", async () => "x");
  order.push("resumed");
  assert.deepEqual(order, ["idle", "resumed"]);
});

test("dialogQueue: log lines carry the open time and the gap to the previous dialog", async () => {
  const lines: string[] = [];
  let clock = 1000;
  const q = createDialogQueue((l) => lines.push(l), () => clock);
  const first = deferred<string>();
  const a = q.run("palette", () => first.promise);
  await tick();
  clock = 1250;
  first.resolve("x");
  await a;
  clock = 1300;
  await q.run("message", async () => "y");
  assert.deepEqual(lines, [
    "cmdAbl [dialog] info: open: palette",
    "cmdAbl [dialog] info: closed: palette (returned a value, open for 250 ms)",
    "cmdAbl [dialog] info: open: message (50 ms after the previous dialog closed)",
    "cmdAbl [dialog] info: closed: message (returned a value, open for 0 ms)",
  ]);
});

test("dialogQueue: reset frees a stuck dialog; a late result is dropped", async () => {
  const lines: string[] = [];
  let clock = 0;
  const q = createDialogQueue((l) => lines.push(l), () => clock);
  const stuck = deferred<string>();
  const first = q.run("palette", () => stuck.promise);
  const waiting = q.run("message", async () => "never runs");
  await tick();
  let idle = 0;
  q.onIdle(() => idle++);
  clock = 61_000;
  assert.deepEqual(q.reset(), { name: "palette", openForMs: 61_000 });
  await assert.rejects(first, /reset/);
  await assert.rejects(waiting, /reset/);
  assert.equal(q.describe(), null);
  assert.equal(idle, 1);
  assert.ok(lines.includes("cmdAbl [dialog] warn: queue reset (was: palette (open), message (queued), open for 61 s)"));

  // The next dialog opens at once, without waiting for the stuck one.
  assert.equal(await q.run("palette", async () => "fresh"), "fresh");

  // The old promise settles later: dropped, nothing thrown, nothing resolved.
  stuck.resolve("late");
  await tick();
  assert.equal(q.describe(), null);
  assert.ok(lines.some((l) => l.startsWith("cmdAbl [dialog] info: closed after a reset: palette")));
});

test("dialogQueue: reset with nothing open returns null; a late rejection is dropped too", async () => {
  const q = createDialogQueue(() => {});
  assert.equal(q.reset(), null);
  const stuck = deferred<string>();
  const run = q.run("pick", () => stuck.promise);
  await tick();
  q.reset();
  await assert.rejects(run, /reset/);
  stuck.reject(new Error("late failure"));
  await tick(); // must not surface as an unhandled rejection
  assert.equal(await q.run("message", async () => "ok"), "ok");
});

test("dialogQueue: a throwing log sink does not leave the caller unsettled", async () => {
  const q = createDialogQueue(() => {
    throw new Error("sink broke");
  });
  assert.equal(await q.run("palette", async () => "ok"), "ok");
  assert.equal(q.describe(), null);
});

test("dialogQueue: after a reset the next dialog reports no gap to the old one", async () => {
  const lines: string[] = [];
  const q = createDialogQueue((l) => lines.push(l), () => 0);
  await q.run("message", async () => "x");
  const stuck = deferred<string>();
  void q.run("palette", () => stuck.promise).catch(() => {});
  await tick();
  q.reset();
  await q.run("palette", async () => "x");
  const opens = lines.filter((l) => l.startsWith("cmdAbl [dialog] info: open: palette"));
  assert.equal(opens.length, 2);
  assert.ok(opens[0]!.includes("after the previous dialog closed")); // the stuck one followed the message
  assert.equal(opens[1], "cmdAbl [dialog] info: open: palette"); // no gap reported after a reset
});
