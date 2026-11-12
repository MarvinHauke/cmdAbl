import { test } from "node:test";
import assert from "node:assert/strict";
import { createPageRun, refusal, trackRuns } from "./pageRun.js";
import { createUiGate } from "../host/headless.js";
import type { CommandNode } from "../command/commandTree.js";
import type { Ui } from "./ui.js";
import { ExitCode } from "../types.js";

const run = () => undefined;
const roots: CommandNode<any, any>[] = [
  { name: "stamp", summary: "stamp", children: [{ name: "loop", summary: "loop", run }, { name: "unloop", summary: "unloop", run }, { name: "other", summary: "other", run }] },
  { name: "mute", summary: "mute", args: [{ name: "t", kind: "text", variadic: true }], run },
  { name: "map", summary: "map", args: [{ name: "line", kind: "text", raw: true, required: false }], run },
];
const ALLOW = ["stamp loop", "stamp unloop"];

test("refusal: listed command paths pass, options and arguments are free", () => {
  assert.equal(refusal("stamp loop", ALLOW, roots), null);
  assert.equal(refusal("stamp unloop", ALLOW, roots), null);
  assert.equal(refusal("stamp loop; stamp unloop", ALLOW, roots), null);
});

test("refusal: unlisted paths, partly unlisted chains, bare | and junk are refused", () => {
  assert.match(refusal("stamp other", ALLOW, roots)!, /not allowed/);
  assert.match(refusal("mute #a", ALLOW, roots)!, /not allowed/);
  assert.match(refusal("stamp loop; mute #a", ALLOW, roots)!, /not allowed/);
  assert.match(refusal("map CC1 | stamp loop", ALLOW, roots)!, /\|/);
  assert.match(refusal("stamp loop | x", ALLOW, roots)!, /\|/);
  assert.ok(refusal("", ALLOW, roots));
  assert.ok(refusal("nonsense", ALLOW, roots));
  assert.ok(refusal("stamp", ALLOW, roots)); // a group without its subcommand is help, not a run
});

test("createPageRun: an allowed line runs, a refusal answers exit 2 and logs a warn line without running", async () => {
  const ran: string[] = [];
  const warned: string[] = [];
  const handler = createPageRun({ roots: () => roots, run: async (line) => (ran.push(line), { code: 0, text: "ok" }), warn: (t) => warned.push(t) })(ALLOW);
  assert.deepEqual(await handler("stamp loop"), { code: 0, text: "ok" });
  const refused = await handler("mute #a");
  assert.equal(refused.code, ExitCode.USAGE);
  assert.equal((await handler("stamp loop; mute #a")).code, ExitCode.USAGE);
  assert.deepEqual(ran, ["stamp loop"]);
  assert.equal(warned.length, 2);
});

test("createPageRun: a throwing run becomes a failure", async () => {
  const handler = createPageRun({ roots: () => roots, run: async () => { throw new Error("boom"); }, warn: () => {} })(ALLOW);
  assert.equal((await handler("stamp loop")).code, ExitCode.FAILURE);
});

test("a nested run: a page run goes headless while the opener's dialog is open, and leaves the dialogs open afterwards", async () => {
  const real: Ui = {
    prompt: async () => null, select: async () => null, notify: () => {}, notifyAnswer: async () => null,
    settings: async () => null, defaults: async () => null, page: async () => null,
    livePage: async () => "closed",
  };
  const gate = createUiGate(real);
  // The opener waits in a real dialog (no capture); the page run uses the gate's headless capture and puts it back.
  let release!: (s: string | null) => void;
  const opener = new Promise<string | null>((resolve) => (release = resolve));
  const capture = { dialogs: [] as string[], notices: [] as string[] };
  assert.equal(gate.active(), false);
  const inner = await gate.within(capture, async () => {
    assert.equal(gate.active(), true);
    assert.equal(await gate.ui.livePage("x", "", 1, 1, {}), null); // dialogs are shut during the page run
    return "ran";
  });
  assert.equal(inner, "ran");
  assert.equal(gate.active(), false); // the opener's wait is not blocked afterwards
  release("done");
  assert.equal(await opener, "done");
  assert.equal(await gate.ui.livePage("x", "", 1, 1, {}), "closed");
  // Nested inside another headless run, the outer capture is put back, not dropped.
  const outer = { dialogs: [] as string[], notices: [] as string[] };
  await gate.within(outer, async () => {
    await gate.within({ dialogs: [], notices: [] }, async () => undefined);
    assert.equal(gate.active(), true);
  });
  assert.equal(gate.active(), false);
});

test("overlapping headless runs: A starts, B starts, A ends, B ends -> dialogs reach the real ui again", async () => {
  const gate = createUiGate({
    prompt: async () => "real" as never, select: async () => null, notify: () => {}, notifyAnswer: async () => null,
    settings: async () => null, defaults: async () => null, page: async () => null, livePage: async () => null,
  });
  let endA!: () => void, endB!: () => void;
  const a = gate.within({ dialogs: [], notices: [] }, () => new Promise<void>((r) => (endA = r)));
  const b = gate.within({ dialogs: [], notices: [] }, () => new Promise<void>((r) => (endB = r)));
  endA();
  await a;
  assert.equal(gate.active(), true); // B still runs
  endB();
  await b;
  assert.equal(gate.active(), false);
  assert.equal(await gate.ui.prompt({} as never), "real");
});

test("trackRuns: idle() waits for a run in flight and resolves at once without one", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const tracked = trackRuns(async () => {
    await new Promise<void>((r) => (finish = r));
    events.push("run done");
    return { code: 0, text: "ok" };
  });
  await tracked.idle(); // nothing in flight
  const run = tracked.run!("stamp loop");
  const idle = tracked.idle().then(() => events.push("idle"));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events, []);
  finish();
  await run;
  await idle;
  assert.deepEqual(events, ["run done", "idle"]);
  assert.equal(trackRuns(undefined).run, undefined);
  await trackRuns(undefined).idle();
});

test("trackRuns: idle() gives up after maxMs on a stuck run", async () => {
  const tracked = trackRuns(() => new Promise(() => {}));
  void tracked.run!("stamp");
  assert.equal(await tracked.idle(20), false);
});
