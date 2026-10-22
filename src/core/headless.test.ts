import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry } from "./commandRegistry.js";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../ableton/objectTree.js";
import { createLog } from "./log.js";
import { ExitCode, ok, fail } from "./types.js";
import { createUiGate, runHeadless } from "./headless.js";
import { confirm } from "./confirm.js";
import type { Ui } from "./ui.js";

let id = 0;
const track = (name: string): ObjectNode => ({ handleId: String(++id), route: [id], kind: "track", scope: "regular", name, path: "", children: [] });
const roots = [track("Kick"), track("Kick"), track("Bass")];
assignPaths(roots, "");
const all = flattenObjectTree(roots);

function realUi() {
  const calls: string[] = [];
  const ui: Ui = {
    prompt: async () => (calls.push("prompt"), null),
    select: async () => (calls.push("select"), [1]),
    notify: (r) => void calls.push(`notify:${r.text}`),
    board: async () => (calls.push("board"), null),
    page: async () => (calls.push("page"), "x"),
  };
  return { ui, calls };
}

function setup() {
  const real = realUi();
  const gate = createUiGate(real.ui);
  const log = createLog(() => {}, 100);
  const registry = new CommandRegistry();
  registry.add({ name: "goto", summary: "go", args: [{ name: "path", kind: "path", rest: true }], run: (inv) => ok(`went ${inv.args[0]?.length}`) });
  registry.add({
    name: "ask",
    summary: "needs a yes",
    run: async () => ((await confirm(gate.ui, "Really?", "Do it")) ? ok("done") : fail(ExitCode.FAILURE, "not confirmed")),
  });
  registry.add({
    name: "say",
    summary: "notifies",
    run: () => {
      gate.ui.notify({ text: "hello", code: 0 });
      return ok();
    },
  });
  registry.add({
    name: "paged",
    summary: "opens a page",
    run: async () => ((await gate.ui.page("mine", "<p>", 10, 10)) === null ? fail(ExitCode.FAILURE, "dismissed") : ok()),
  });
  registry.add({ name: "boom", summary: "throws", run: () => { throw new Error("kaput"); } });
  const deps = { registry, liveNodes: () => all, log: (line: string) => log.record(line) };
  let t = 0;
  return { gate, real, log, deps, now: () => (t += 5) };
}

test("headless: a clean run answers code, empty message, its own log lines and no dialogs", async () => {
  const s = setup();
  s.log.logger("other").info("before the run");
  const out = await runHeadless("goto /Bass", s.deps, s.gate, { log: s.log, now: s.now });
  assert.equal(out.code, ExitCode.OK);
  assert.equal(out.message, "went 1");
  assert.deepEqual(out.dialogs, []);
  assert.ok(out.log.some((l) => l.includes("start: goto /Bass")));
  assert.ok(!out.log.some((l) => l.includes("before the run")));
  assert.ok(out.ms > 0);
  assert.deepEqual(s.real.calls, []); // nothing reached the real surfaces
});

test("headless: an ambiguous address ends with exit 4, lists the candidates and opens no dialog", async () => {
  const s = setup();
  const out = await runHeadless("goto kick", s.deps, s.gate, { log: s.log });
  assert.equal(out.code, ExitCode.AMBIGUOUS);
  assert.match(out.message, /ambiguous/);
  assert.match(out.message, /Kick#1/);
  assert.match(out.message, /Kick#2/);
  assert.equal(out.dialogs.length, 1);
  assert.match(out.dialogs[0]!, /^pick /);
  assert.deepEqual(s.real.calls, []);
});

test("headless: a confirm counts as dismissed, the command gets 'not confirmed' and the outcome names the dialog", async () => {
  const s = setup();
  const out = await runHeadless("ask", s.deps, s.gate, { log: s.log });
  assert.equal(out.code, ExitCode.FAILURE);
  assert.match(out.message, /not confirmed/);
  assert.equal(out.dialogs.length, 1);
  assert.match(out.dialogs[0]!, /Really\?/);
  assert.deepEqual(s.real.calls, []);
});

test("headless: a module page is dismissed and named; notify is captured", async () => {
  const s = setup();
  const paged = await runHeadless("paged", s.deps, s.gate, { log: s.log });
  assert.deepEqual(paged.dialogs, ['page "mine"']);
  assert.equal(paged.code, ExitCode.FAILURE);
  const said = await runHeadless("say", s.deps, s.gate, { log: s.log });
  assert.deepEqual(said.notices, ["hello"]);
  assert.deepEqual(s.real.calls, []);
});

test("headless: a throwing command and an unknown command answer a code, never throw", async () => {
  const s = setup();
  const boom = await runHeadless("boom", s.deps, s.gate, { log: s.log });
  assert.equal(boom.code, ExitCode.FAILURE);
  assert.match(boom.message, /kaput/);
  const unknown = await runHeadless("nonsense", s.deps, s.gate, { log: s.log });
  assert.notEqual(unknown.code, ExitCode.OK);
});

test("the gate passes everything to the real surfaces outside a headless run", async () => {
  const s = setup();
  assert.equal(s.gate.active(), false);
  assert.deepEqual(await s.gate.ui.select({ title: "t", multi: false, items: [{ label: "a" }] }), [1]);
  s.gate.ui.notify({ text: "shown", code: 0 });
  assert.deepEqual(s.real.calls, ["select", "notify:shown"]);
  await s.gate.within({ dialogs: [], notices: [] }, async () => assert.equal(s.gate.active(), true));
  assert.equal(s.gate.active(), false);
});

test("log marks: since() returns only the lines written after the mark, also when old lines were dropped", () => {
  const log = createLog(() => {}, 3);
  log.logger("a").info("one");
  const mark = log.mark();
  log.logger("a").info("two");
  log.logger("a").info("three");
  assert.deepEqual(log.since(mark).map((l) => l.replace(/^.*info: /, "")), ["two", "three"]);
  for (let i = 0; i < 5; i++) log.logger("a").info(`n${i}`);
  assert.equal(log.since(mark).length, 3); // capped by the buffer
  assert.deepEqual(log.since(log.mark()), []);
});

test("release opens the surfaces again while a run is stuck; the late end does not close a newer capture", async () => {
  const s = setup();
  let finishOld: () => void = () => {};
  const old = s.gate.within({ dialogs: [], notices: [] }, () => new Promise<void>((r) => (finishOld = r)));
  assert.equal(s.gate.active(), true);
  assert.equal(s.gate.release(), true);
  assert.equal(s.gate.active(), false);
  assert.equal(s.gate.release(), false);
  const newer = { dialogs: [] as string[], notices: [] as string[] };
  let finishNew: () => void = () => {};
  const second = s.gate.within(newer, () => new Promise<void>((r) => (finishNew = r)));
  finishOld();
  await old;
  assert.equal(s.gate.active(), true); // the newer run keeps its capture
  finishNew();
  await second;
  assert.equal(s.gate.active(), false);
});
