import { test } from "node:test";
import assert from "node:assert/strict";
import { createSetWatch, type SetId } from "./setWatch.js";
import { TOPIC_ORDER } from "./topics.js";

function setup(answers: Array<{ ok: true; id: SetId } | { ok: false }>) {
  let n = 0;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const watch = createSetWatch({
    read: async () => answers[Math.min(n++, answers.length - 1)]!,
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => {},
  });
  const heard: SetId[] = [];
  /** Run the next scheduled poll and let it finish. */
  const tick = async () => {
    const t = timers.shift();
    t?.fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { watch, heard, timers, tick, reads: () => n };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test("a listener hears the id once the script answers, and again only when it changes", async () => {
  const s = setup([{ ok: true, id: "a" }, { ok: true, id: "a" }, { ok: true, id: "b" }, { ok: true, id: "b" }]);
  s.watch.onChange((id) => s.heard.push(id));
  await flush();
  assert.deepEqual(s.heard, ["a"]);
  await s.tick();
  assert.deepEqual(s.heard, ["a"]); // the same id: nothing new
  await s.tick();
  assert.deepEqual(s.heard, ["a", "b"]); // another Set was opened
  await s.tick();
  assert.deepEqual(s.heard, ["a", "b"]);
  assert.equal(s.watch.current(), "b");
});

test("a script that comes up later is heard when it first answers; while it is down the polling slows down", async () => {
  const s = setup([{ ok: false }, { ok: false }, { ok: true, id: null }]);
  s.watch.onChange((id) => s.heard.push(id));
  await flush();
  assert.deepEqual(s.heard, []);
  assert.equal(s.timers[0]!.ms, 3000); // the first poll is scheduled at the normal pace
  await s.tick(); // fails again
  assert.equal(s.timers[0]!.ms, 10000); // slower while down
  await s.tick(); // answers: a Set without an id is a valid answer (null)
  assert.deepEqual(s.heard, [null]);
  assert.equal(s.timers[0]!.ms, 3000);
});

test("a listener added later is told the known id at once; a throwing listener does not stop the others", async () => {
  const s = setup([{ ok: true, id: "a" }]);
  s.watch.onChange(() => {
    throw new Error("broken");
  });
  await flush();
  s.watch.onChange((id) => s.heard.push(id));
  await flush();
  assert.deepEqual(s.heard, ["a"]);
  assert.equal(s.timers.length, 1); // one poll timer however many listeners
});

test("a throwing read counts as down; check() reads now and shares a running read; stop ends the polling", async () => {
  let calls = 0;
  const watch = createSetWatch({
    read: async () => {
      calls++;
      throw new Error("bridge");
    },
    setTimer: () => 1,
    clearTimer: () => {},
  });
  await watch.check();
  await Promise.all([watch.check(), watch.check()]);
  assert.equal(calls, 2); // the two concurrent checks shared one read
  assert.equal(watch.current(), undefined);
  watch.stop();
});

test("the topic Control follows Mix", () => {
  assert.deepEqual(TOPIC_ORDER.slice(1, 3), ["Mix", "Control"]);
});
