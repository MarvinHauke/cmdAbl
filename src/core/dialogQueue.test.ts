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
  const q = createDialogQueue((l) => lines.push(l));
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
    "cmdAbl: dialog open: palette",
    "cmdAbl: dialog closed: palette (no value)",
    "cmdAbl: dialog open: message",
    "cmdAbl: dialog closed: message (returned a value)",
  ]);
});

test("dialogQueue: a rejected dialog reaches its caller but does not block the queue", async () => {
  const lines: string[] = [];
  const q = createDialogQueue((l) => lines.push(l));
  const failing = q.run("palette", () => Promise.reject(new Error("boom")));
  const after = q.run("message", async () => "ok");
  await assert.rejects(failing, /boom/);
  assert.equal(await after, "ok");
  assert.equal(q.describe(), null);
  assert.ok(lines.includes("cmdAbl: dialog failed: palette (boom)"));
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
