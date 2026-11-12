import { test } from "node:test";
import assert from "node:assert/strict";
import { createPageRun, runLivePage } from "./pageRun.js";
import { callStore } from "../command/innerRun.js";
import { ok } from "../types.js";
import type { LiveRun, LiveSession } from "./livePage.js";
import type { CommandNode } from "../command/commandTree.js";

const run = () => undefined;
const roots: CommandNode<any, any>[] = [
  { name: "loop", summary: "loop", children: [{ name: "back", summary: "back", run }, { name: "here", summary: "here", run }] },
  { name: "mute", summary: "mute", args: [{ name: "t", kind: "text", variadic: true }], run },
];

/** The flow over a fake dialog; `onShow` runs while the dialog is "open" and gets the session's page-run handler. */
function setup(opts: { server?: boolean; onShow?: (run: LiveRun | undefined) => Promise<string> | string }) {
  const events: string[] = [];
  const warned: string[] = [];
  let handler: LiveRun | undefined;
  const make = createPageRun({
    roots: () => roots,
    exec: async (line) => (events.push(`run ${line}`), ok()),
    warn: (t) => warned.push(t),
  });
  const session = { url: "http://x/", close: () => events.push("session closed") } as unknown as LiveSession;
  const ui = {
    livePage: (_n: string, _h: string, _w: number, _ht: number, _r: unknown, options?: { run?: string[]; onClose?: string }) =>
      callStore.run({ path: "x", line: "x", runs: ["loop back", "loop here"], inner: false, live: { on: true } }, () => runLivePage({
        name: "p",
        run: options?.run,
        onClose: options?.onClose,
        pageRun: make,
        open: (h) => (opts.server === false ? null : ((handler = h), session)),
        showData: async () => (events.push("dialog"), (await opts.onShow?.(undefined)) as string),
        showLive: async () => (events.push("dialog"), (await opts.onShow?.(handler)) as string),
      })),
  };
  return { ui, events, warned };
}

test("onClose runs once after the close, with the page's answer returned unchanged", async () => {
  const s = setup({ onShow: (r) => (void r!("loop here"), "answer") });
  const answer = await s.ui.livePage("p", "<html>", 10, 10, {}, { run: ["loop back"], onClose: "loop back" });
  assert.equal(answer, "answer");
  assert.deepEqual(s.events.filter((e) => e !== "run loop here"), ["dialog", "session closed", "run loop back"]);
});

test("onClose waits for page runs in flight", async () => {
  const s = setup({
    onShow: (r) => {
      void r!("loop here"); // started, not awaited: still in flight when the dialog closes
      return "x";
    },
  });
  await s.ui.livePage("p", "<html>", 10, 10, {}, { run: ["loop here", "loop back"], onClose: "loop back" });
  assert.deepEqual(s.events.filter((e) => e.startsWith("run")), ["run loop here", "run loop back"]);
});

test("onClose also runs when the page is dismissed after a run", async () => {
  const s = setup({ onShow: (r) => (void r!("loop here"), "") });
  assert.equal(await s.ui.livePage("p", "<html>", 10, 10, {}, { run: ["loop back"], onClose: "loop back" }), null);
  assert.ok(s.events.includes("run loop back"));
});

test("no page run -> no onClose: plain read, dismiss, data page, failed dialog", async () => {
  for (const server of [true, false]) {
    const s = setup({ server, onShow: () => "" });
    assert.equal(await s.ui.livePage("p", "<html>", 10, 10, {}, { run: ["loop here", "loop back"], onClose: "loop back" }), null);
    assert.ok(!s.events.some((e) => e.startsWith("run")));
  }
});

test("onClose that is not in run is refused with a warn line and does not run", async () => {
  const s = setup({ onShow: (r) => (void r!("loop here"), "x") });
  await s.ui.livePage("p", "<html>", 10, 10, {}, { run: ["loop here"], onClose: "loop back" });
  assert.ok(!s.events.includes("run loop back"));
  assert.equal(s.warned.length, 1);
});

test("without onClose nothing extra runs", async () => {
  const s = setup({ onShow: () => "x" });
  await s.ui.livePage("p", "<html>", 10, 10, {}, { run: ["loop back"] });
  assert.ok(!s.events.some((e) => e.startsWith("run")));
});
