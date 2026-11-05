import { test } from "node:test";
import assert from "node:assert/strict";
import { createMidiEngine, type MidiBinding } from "./midiEngine.js";
import { createMidiPort } from "./midiPort.js";
import { parseControl, type MidiMessage } from "./midi.js";
import { ExitCode } from "./types.js";

const cc = (value: number, number = 51, channel = 1): MidiMessage => ({ type: "cc", channel, number, value });
const note = (type: "note_on" | "note_off", number = 36): MidiMessage => ({ type, channel: 1, number, value: type === "note_on" ? 100 : 0 });
const bind = (control: string, operator: MidiBinding["operator"], line: string, threshold?: number): MidiBinding => ({
  control: parseControl(control)!,
  operator,
  line,
  ...(threshold !== undefined ? { threshold } : {}),
});

function setup(options: { enabled?: () => boolean | Promise<boolean>; answer?: (line: string) => { code: number; message: string; dialogs?: string[] } | Promise<{ code: number; message: string; dialogs?: string[] }> } = {}) {
  const ran: string[] = [];
  const logs: string[] = [];
  const engine = createMidiEngine({
    run: async (line) => {
      ran.push(line);
      return (await options.answer?.(line)) ?? { code: 0, message: "" };
    },
    enabled: options.enabled ?? (() => true),
    log: { info: (t) => logs.push(`info ${t}`), warn: (t) => logs.push(`warn ${t}`), debug: (t) => logs.push(`debug ${t}`) },
    now: () => 0,
  });
  return { engine, ran, logs };
}

test("a press runs the bound line once; the UC4's 10 then 0 is one press", async () => {
  const { engine, ran, logs } = setup();
  assert.deepEqual(engine.setBindings([bind("CC51", "press", "mute #drums --set 0")]).refused, []);
  await engine.handle(cc(10));
  await engine.handle(cc(0));
  assert.deepEqual(ran, ["mute #drums --set 0"]);
  assert.equal(logs.length, 1); // one log line per firing
  assert.match(logs[0]!, /^info CC51 press -> mute #drums --set 0 -> exit 0/);
});

test("hold substitutes 1 and 0, toggle 1, 0, 1 …, in every {} of the line", async () => {
  const { engine, ran } = setup();
  engine.setBindings([bind("N36", "hold", "mute #drums --set {}"), bind("CC37", "toggle", "solo #lead --set {}; vol {}")]);
  await engine.handle(note("note_on"));
  await engine.handle(note("note_off"));
  await engine.handle(cc(127, 37));
  await engine.handle(cc(0, 37));
  await engine.handle(cc(127, 37));
  assert.deepEqual(ran, ["mute #drums --set 1", "mute #drums --set 0", "solo #lead --set 1; vol 1", "solo #lead --set 0; vol 0"]);
});

test("{} with press or release is refused at setBindings (exit 2 text), the other rows stay", () => {
  const { engine } = setup();
  const { refused: problems, kept } = engine.setBindings([bind("CC1", "press", "mute --set {}"), bind("CC2", "release", "vol {}"), bind("CC3", "hold", "mute --set {}")]);
  assert.deepEqual(kept.map((b) => b.line), ["mute --set {}"]);
  assert.deepEqual(problems, ["CC1 press: press gives no value; use hold or toggle", "CC2 release: release gives no value; use hold or toggle"]);
  assert.equal(engine.bindings().length, 1);
  assert.equal(ExitCode.USAGE, 2);
});

test("a message that matches no binding does nothing; channels limit, omni matches all", async () => {
  const { engine, ran } = setup();
  engine.setBindings([bind("CC51/ch2", "press", "a"), bind("CC52", "press", "b")]);
  await engine.handle(cc(10, 51, 1));
  await engine.handle(cc(10, 99));
  await engine.handle(cc(10, 52, 9));
  await engine.handle(cc(10, 51, 2));
  assert.deepEqual(ran, ["b", "a"]);
});

test("several bindings of one control each fire", async () => {
  const { engine, ran } = setup();
  engine.setBindings([bind("CC51", "press", "a"), bind("CC51", "hold", "b {}")]);
  await engine.handle(cc(10));
  assert.deepEqual(ran, ["a", "b 1"]);
});

test("a firing while the same binding still runs is dropped; a toggle advances only when a run starts", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { engine, ran, logs } = setup({ answer: async () => (await gate, { code: 0, message: "" }) });
  engine.setBindings([bind("CC37", "toggle", "solo #lead --set {}")]);
  const first = engine.handle(cc(127, 37)); // starts: 1
  await new Promise((r) => setTimeout(r, 0));
  await engine.handle(cc(0, 37));
  const dropped = await engine.handle(cc(127, 37)); // still running: dropped, the toggle does not advance
  assert.equal(dropped[0]!.status, "dropped");
  assert.ok(logs.some((l) => l.startsWith("debug CC37 toggle: dropped")));
  release();
  await first;
  await engine.handle(cc(0, 37));
  await engine.handle(cc(127, 37)); // the next real start hands 0 (the dropped one did not count)
  assert.deepEqual(ran, ["solo #lead --set 1", "solo #lead --set 0"]);
});

test("another binding is not held up by a slow one", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { engine, ran } = setup({ answer: async (line) => (line === "slow" ? (await gate, { code: 0, message: "" }) : { code: 0, message: "" }) });
  engine.setBindings([bind("CC1", "press", "slow"), bind("CC2", "press", "fast")]);
  const slow = engine.handle(cc(10, 1));
  await new Promise((r) => setTimeout(r, 0));
  await engine.handle(cc(10, 2));
  assert.deepEqual(ran, ["slow", "fast"]);
  release();
  await slow;
});

test("map.enabled false drops every message (state included); true again works at once", async () => {
  let enabled = false;
  const { engine, ran } = setup({ enabled: async () => enabled });
  engine.setBindings([bind("CC51", "press", "mute #a")]);
  await engine.handle(cc(10));
  await engine.handle(cc(0));
  assert.deepEqual(ran, []);
  enabled = true;
  await engine.handle(cc(10));
  assert.deepEqual(ran, ["mute #a"]);
});

test("a failing or throwing run is logged and never stops the engine; the binding is free again", async () => {
  let n = 0;
  const { engine, ran, logs } = setup({
    answer: () => {
      n++;
      if (n === 1) return { code: 4, message: "ambiguous: /Kick#1\n/Kick#2" };
      if (n === 2) throw new Error("boom");
      return { code: 0, message: "" };
    },
  });
  engine.setBindings([bind("N36", "press", "mute kick")]);
  for (let i = 0; i < 3; i++) {
    await engine.handle(note("note_on"));
    await engine.handle(note("note_off"));
  }
  assert.equal(ran.length, 3);
  assert.match(logs[0]!, /exit 4 \(0 ms\): ambiguous: \/Kick#1$/);
  assert.match(logs[1]!, /^warn .*failed: boom/);
  assert.match(logs[2]!, /exit 0/);
});

test("messages are decided in arrival order even when the enabled check is slow", async () => {
  const { engine, ran } = setup({ enabled: () => new Promise((r) => setTimeout(() => r(true), 5)) });
  engine.setBindings([bind("CC1", "hold", "x {}")]);
  await Promise.all([engine.handle(cc(10, 1)), engine.handle(cc(0, 1)), engine.handle(cc(10, 1))]);
  assert.deepEqual(ran, ["x 1", "x 0", "x 1"]);
});

// ── the module-facing port ─────────────────────────────────────────────────────────────────

function portSetup() {
  const listens: Array<{ controls: unknown; options: unknown }> = [];
  const { engine, ran } = setup();
  let clock = 1000;
  const runtime = createMidiPort({
    engine,
    listen: async (controls, options) => {
      listens.push({ controls, options });
      return { ok: true, value: { count: controls === "all" ? 4112 : controls === "none" ? 0 : controls.length, monitor: options.monitor === true } };
    },
    last: async (since) => ({ ok: true, value: { last: since + 1, messages: [] } }),
    blocked: () => [],
    onBlocked: () => () => {},
    statusBar: async () => false,
    enabled: async () => true,
    setEnabled: async () => true,
    now: () => clock,
  });
  return { runtime, listens, ran, advance: (ms: number) => (clock += ms) };
}

test("setBindings forwards exactly the bound controls (refused rows left out) and reports the refused ones", async () => {
  const { runtime, listens } = portSetup();
  const reply = await runtime.port.setBindings([bind("CC51", "press", "a"), bind("N36/ch2", "hold", "b {}"), bind("CC9", "press", "c {}"), bind("CC51", "toggle", "d {}")]);
  assert.deepEqual(reply, { ok: true, value: { count: 2, refused: ["CC9 press: press gives no value; use hold or toggle"] } });
  assert.deepEqual(listens[0]!.controls, [{ type: "cc", number: 51 }, { type: "note", channel: 2, number: 36 }]);
  await runtime.port.setBindings([]);
  assert.equal(listens[1]!.controls, "none");
});

test("listen adds controls to the bound ones; monitor pauses the bound lines while its window is open", async () => {
  const { runtime, listens, ran, advance } = portSetup();
  await runtime.port.setBindings([bind("CC51", "press", "a")]);
  await runtime.port.listen([parseControl("CC7")!, parseControl("CC51")!]);
  assert.deepEqual(listens[1]!.controls, [{ type: "cc", number: 51 }, { type: "cc", number: 7 }]); // deduplicated
  await runtime.intake({ seq: 1, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ran, ["a"]);
  await runtime.port.listen("all", { monitor: true, seconds: 10 });
  // a monitor window is not a forward-everything: the script is asked for the bound and added controls, with monitor
  assert.deepEqual(listens[2], { controls: [{ type: "cc", number: 51 }, { type: "cc", number: 7 }], options: { monitor: true, seconds: 10, status: false } });
  await runtime.intake({ seq: 2, type: "cc", channel: 1, number: 51, value: 0, time: 0 });
  await runtime.intake({ seq: 3, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ran, ["a"]); // learning: nothing fired
  advance(11_000);
  await runtime.intake({ seq: 4, type: "cc", channel: 1, number: 51, value: 0, time: 0 });
  await runtime.intake({ seq: 5, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ran, ["a", "a"]);
  await runtime.port.listen("none");
  assert.deepEqual(listens[3]!.controls, [{ type: "cc", number: 51 }]); // back to the bound ones
});

test("last asks the script; a bridge failure comes back as the failure", async () => {
  const { runtime } = portSetup();
  assert.deepEqual(await runtime.port.last(5), { ok: true, value: { last: 6, messages: [] } });
  const failing = createMidiPort({
    engine: setup().engine,
    listen: async () => ({ ok: false, code: 5, text: "script not running" }),
    last: async () => ({ ok: false, code: 5, text: "script not running" }),
    blocked: () => { throw new Error("no bridge"); },
    onBlocked: () => () => {},
    statusBar: async () => { throw new Error("no settings"); },
    enabled: async () => { throw new Error("no settings"); },
    setEnabled: async () => { throw new Error("no settings"); },
  });
  assert.equal(await failing.port.enabled(), true); // unreadable settings: on
  assert.equal(await failing.port.setEnabled(false), false);
  assert.deepEqual(await failing.port.setBindings([bind("CC1", "press", "a")]), { ok: false, code: 5, text: "script not running" });
  assert.equal((await failing.port.last()).ok, false);
  await failing.intake({ seq: 1, type: "cc", channel: 1, number: 1, value: 10, time: 0 }); // never throws
});

test("a monitor window never makes 'all' permanent, pauses the lines whatever its controls are, and setBindings ends it", async () => {
  const { runtime, listens, ran } = portSetup();
  await runtime.port.setBindings([bind("CC51", "press", "a")]);
  await runtime.port.listen("all", { monitor: true });
  await runtime.port.setBindings([bind("CC51", "press", "a"), bind("CC52", "press", "b")]);
  assert.deepEqual(listens[2]!.controls, [{ type: "cc", number: 51 }, { type: "cc", number: 52 }]); // not "all" after the window
  assert.deepEqual(listens[2]!.options, {});
  // monitor with "none" still pauses the lines
  await runtime.port.listen("none", { monitor: true });
  await runtime.intake({ seq: 1, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ran, []);
  // the learn flow: monitor, then setBindings: the binding fires at once, not after the old deadline
  await runtime.port.setBindings([bind("CC51", "press", "a")]);
  await runtime.intake({ seq: 2, type: "cc", channel: 1, number: 51, value: 0, time: 0 });
  await runtime.intake({ seq: 3, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ran, ["a"]);
});

test("a failing listen changes nothing: no window, no extra controls, the old bound controls", async () => {
  let ok = true;
  const { engine, ran } = setup();
  const runtime = createMidiPort({
    engine,
    listen: async (controls) => (ok ? { ok: true, value: { count: 1, monitor: false } } : { ok: false, code: 5, text: "down" }),
    last: async () => ({ ok: false, code: 5, text: "down" }),
    blocked: () => [],
    onBlocked: () => () => {},
    statusBar: async () => false,
    enabled: async () => true,
    setEnabled: async () => true,
  });
  await runtime.port.setBindings([bind("CC51", "press", "a")]);
  ok = false;
  assert.equal((await runtime.port.listen("all", { monitor: true })).ok, false);
  await runtime.intake({ seq: 1, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ran, ["a"]); // no window opened
});

test("hold: a quick tap while the line runs still ends with the release (0); a newer waiting value replaces an older one", async () => {
  let release!: () => void;
  let first = true;
  const gate = new Promise<void>((r) => (release = r));
  const { engine, ran, logs } = setup({
    answer: async () => {
      if (first) {
        first = false;
        await gate;
      }
      return { code: 0, message: "" };
    },
  });
  engine.setBindings([bind("N36", "hold", "mute #a --set {}")]);
  const press = engine.handle(note("note_on")); // starts: 1, still running
  await new Promise((r) => setTimeout(r, 0));
  const queued = await Promise.all([engine.handle(note("note_off"))].map((p) => Promise.race([p, new Promise((r) => setTimeout(() => r("pending"), 5))])));
  assert.equal(queued[0], "pending"); // the release waits for the running line
  assert.deepEqual(ran, ["mute #a --set 1"]);
  // more edges while it still runs: the newest value is the one that waits (1, then 0 again)
  void engine.handle(note("note_on"));
  void engine.handle(note("note_off"));
  await new Promise((r) => setTimeout(r, 5));
  release();
  await press;
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(ran, ["mute #a --set 1", "mute #a --set 0"]); // the last release ran once, the older waiting values were replaced
  assert.ok(logs.some((l) => l.startsWith("debug N36 hold: queued mute #a --set 0")));
});

test("press, release and toggle are still dropped (not queued) while their line runs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { engine, ran } = setup({ answer: async () => (await gate, { code: 0, message: "" }) });
  engine.setBindings([bind("CC1", "press", "a"), bind("CC2", "release", "b"), bind("CC3", "toggle", "c {}")]);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const pending: Array<Promise<unknown>> = [];
  const send = async (m: MidiMessage) => {
    pending.push(engine.handle(m)); // a firing's handle() waits for its run: do not await it here
    await tick();
  };
  await send(cc(10, 1)); // a starts
  await send(cc(10, 3)); // c 1 starts
  await send(cc(0, 1));
  await send(cc(10, 1)); // press again while a runs: dropped
  await send(cc(0, 3));
  await send(cc(10, 3)); // toggle press while c runs: dropped
  await send(cc(10, 2));
  await send(cc(0, 2)); // b starts
  await send(cc(10, 2));
  await send(cc(0, 2)); // release again while b runs: dropped
  release();
  await Promise.all(pending);
  assert.deepEqual([...ran].sort(), ["a", "b", "c 1"]);
});

test("adding a binding keeps the state of the unchanged ones (a toggle does not start over)", async () => {
  const { engine, ran } = setup();
  const toggle = bind("CC37", "toggle", "solo #lead --set {}");
  engine.setBindings([toggle]);
  await engine.handle(cc(127, 37));
  await engine.handle(cc(0, 37));
  engine.setBindings([toggle, bind("CC1", "press", "next")]);
  await engine.handle(cc(127, 37));
  assert.deepEqual(ran, ["solo #lead --set 1", "solo #lead --set 0"]); // the second press hands 0, not 1 again
  engine.setBindings([bind("CC37", "toggle", "solo #lead --set {}; vol 1")]); // another line is another binding: fresh
  await engine.handle(cc(0, 37));
  await engine.handle(cc(127, 37));
  assert.equal(ran.at(-1), "solo #lead --set 1; vol 1");
});

test("a failed listen puts the engine's table back as it was", async () => {
  let ok = true;
  const { engine, ran } = setup();
  const runtime = createMidiPort({
    engine,
    listen: async () => (ok ? { ok: true, value: { count: 1, monitor: false } } : { ok: false, code: 5, text: "down" }),
    last: async () => ({ ok: false, code: 5, text: "down" }),
    blocked: () => [],
    onBlocked: () => () => {},
    statusBar: async () => false,
    enabled: async () => true,
    setEnabled: async () => true,
  });
  await runtime.port.setBindings([bind("CC51", "press", "a")]);
  ok = false;
  assert.equal((await runtime.port.setBindings([bind("CC52", "press", "b")])).ok, false);
  assert.deepEqual(engine.bindings().map((b) => b.line), ["a"]);
  await runtime.intake({ seq: 1, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ran, ["a"]);
});

test("setBindings while a line runs: the binding keeps working afterwards (the running flag is not lost)", async () => {
  let release!: () => void;
  let first = true;
  const gate = new Promise<void>((r) => (release = r));
  const { engine, ran } = setup({
    answer: async () => {
      if (first) {
        first = false;
        await gate;
      }
      return { code: 0, message: "" };
    },
  });
  const slow = bind("CC1", "press", "slow");
  engine.setBindings([slow]);
  const running = engine.handle(cc(10, 1)); // starts, blocked
  await new Promise((r) => setTimeout(r, 0));
  engine.setBindings([slow, bind("CC2", "press", "new")]); // learn/add while it runs
  release();
  await running;
  await engine.handle(cc(0, 1));
  await engine.handle(cc(10, 1)); // must run again
  await engine.handle(cc(10, 2));
  assert.deepEqual(ran, ["slow", "slow", "new"]);
});

test("blocked / onBlocked pass the bridge's list through; a failing read is 'unknown' and a throwing listener is skipped", () => {
  let current: string[] | null = ["CC51/ch1"];
  const callbacks: Array<(b: string[] | null) => void> = [];
  const runtime = createMidiPort({
    engine: setup().engine,
    listen: async () => ({ ok: true, value: { count: 0, monitor: false } }),
    last: async () => ({ ok: true, value: { last: 0, messages: [] } }),
    blocked: () => current,
    onBlocked: (cb) => (callbacks.push(cb), () => void callbacks.splice(callbacks.indexOf(cb), 1)),
    statusBar: async () => false,
    enabled: async () => true,
    setEnabled: async () => true,
  });
  assert.deepEqual(runtime.port.blocked(), ["CC51/ch1"]);
  const heard: Array<string[] | null> = [];
  runtime.port.onBlocked(() => {
    throw new Error("broken");
  });
  const off = runtime.port.onBlocked((b) => heard.push(b));
  current = null;
  for (const cb of callbacks) cb(current);
  assert.deepEqual(heard, [null]); // the broken listener did not stop the other
  off(); // the returned function removes the listener
  for (const cb of callbacks) cb(["CC1/ch1"]);
  assert.deepEqual(heard, [null]);
  assert.equal(runtime.port.blocked(), null);
});

test("an event marked monitor never runs a binding (engine and port), but every listener sees it", async () => {
  const { engine, ran } = setup();
  engine.setBindings([bind("CC51", "press", "a")]);
  assert.deepEqual(await engine.handle({ ...cc(10), monitor: true }), []);
  await engine.handle(cc(0));
  assert.deepEqual(ran, []);
  const { runtime, ran: ranViaPort } = portSetup();
  await runtime.port.setBindings([bind("CC51", "press", "a")]);
  const seen: Array<{ number: number; monitor?: true }> = [];
  const off = runtime.port.onEvent((e) => seen.push({ number: e.number, monitor: e.monitor }));
  runtime.port.onEvent(() => {
    throw new Error("broken");
  });
  await runtime.intake({ seq: 1, type: "cc", channel: 1, number: 51, value: 10, time: 0, monitor: true }); // during a monitor window
  assert.deepEqual(ranViaPort, []);
  assert.deepEqual(seen, [{ number: 51, monitor: true }]); // seen, though the broken listener threw
  await runtime.intake({ seq: 2, type: "cc", channel: 1, number: 51, value: 0, time: 0 });
  await runtime.intake({ seq: 3, type: "cc", channel: 1, number: 51, value: 10, time: 0 });
  assert.deepEqual(ranViaPort, ["a"]); // an ordinary event runs, and the listener sees it too
  assert.equal(seen.length, 3);
  off();
  await runtime.intake({ seq: 4, type: "cc", channel: 1, number: 9, value: 1, time: 0 });
  assert.equal(seen.length, 3); // unsubscribed
});

test("midi.statusBar: monitor asks the script for the status bar only when the setting is on; a failing read is off", async () => {
  const seen: Array<{ monitor?: boolean; seconds?: number; status?: boolean }> = [];
  let on = false;
  let broken = false;
  const runtime = createMidiPort({
    engine: setup().engine,
    listen: async (_controls, options) => (seen.push(options), { ok: true, value: { count: 0, monitor: options.monitor === true } }),
    last: async () => ({ ok: true, value: { last: 0, messages: [] } }),
    blocked: () => [],
    onBlocked: () => () => {},
    statusBar: async () => {
      if (broken) throw new Error("settings");
      return on;
    },
    enabled: async () => true,
    setEnabled: async () => true,
  });
  await runtime.port.listen("all", { monitor: true, seconds: 5 });
  on = true;
  await runtime.port.listen("all", { monitor: true, seconds: 5 });
  broken = true;
  await runtime.port.listen("all", { monitor: true, seconds: 5 });
  await runtime.port.listen("none"); // no monitor: no status option
  assert.deepEqual(seen.map((o) => o.status), [false, true, false, undefined]);
  assert.equal(await runtime.port.statusBar(), false); // a failing read is off
  broken = false;
  assert.equal(await runtime.port.statusBar(), true);
});

test("a dialog that was cancelled is warned about once per binding, with its kind; every firing keeps the info line", async () => {
  const { engine, logs } = setup({ answer: () => ({ code: 4, message: "ambiguous: mute: which tags?", dialogs: ['tags "mute: which tags?": #a, #b'] }) });
  engine.setBindings([bind("CC48", "toggle", "mute")]);
  await engine.handle(cc(127, 48));
  await engine.handle(cc(0, 48));
  await engine.handle(cc(127, 48));
  const warns = logs.filter((l) => l.startsWith("warn"));
  assert.equal(warns.length, 1);
  assert.match(warns[0]!, /CC48 toggle: "mute" asked for a tag pick list; MIDI can't show dialogs, so it was cancelled\. Bind a concrete line/);
  assert.equal(logs.filter((l) => l.startsWith("info")).length, 2);
});

test("an unknown dialog kind is called a dialog", async () => {
  const { engine, logs } = setup({ answer: () => ({ code: 1, message: "cancelled", dialogs: ["palette"] }) });
  engine.setBindings([bind("CC49", "press", "x")]);
  await engine.handle(cc(127, 49));
  assert.match(logs.find((l) => l.startsWith("warn"))!, /asked for a dialog;/);
});
