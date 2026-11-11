import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry, type Command } from "./commandRegistry.js";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../../ableton/objectTree.js";
import { ExitCode, fail } from "../types.js";
import { runLine, type RunDeps } from "./run.js";
import { presentResult } from "../surfaces/present.js";
import { chainSegments, quoteIfNeeded, splitChain } from "./tokenize.js";
import { createLog } from "../log.js";
import { createUiGate, runHeadless } from "../host/headless.js";
import type { Ui } from "../surfaces/ui.js";

let id = 0;
const track = (name: string): ObjectNode => ({ handleId: String(++id), route: [id], kind: "track", scope: "regular", name, path: "", children: [] });
const roots = [track("Kick"), track("Kick"), track("Bass"), track("Lead")];
assignPaths(roots, "");
const all = flattenObjectTree(roots);

function setup(pickAnswer: (candidates: ObjectNode[]) => ObjectNode[] | null = () => null) {
  const registry = new CommandRegistry();
  const calls: string[] = [];
  const lines: string[] = [];
  const named = (name: string): Command["run"] => (inv) => {
    calls.push(`${name} ${(inv.args[0] ?? []).map((v) => (typeof v === "string" ? v : v.path)).join(",")}`.trim());
  };
  registry.add({ name: "mute", summary: "mute", args: [{ name: "t", kind: "path", variadic: true }], run: named("mute") });
  registry.add({ name: "solo", summary: "solo", args: [{ name: "t", kind: "path", variadic: true }], run: named("solo") });
  registry.add({ name: "note", summary: "note", args: [{ name: "text", kind: "text", rest: true }], run: named("note") });
  registry.add({ name: "nope", summary: "fails", run: () => (calls.push("nope"), fail(ExitCode.FAILURE, "no good")) });
  registry.add({ name: "gone", summary: "not found", run: () => (calls.push("gone"), fail(ExitCode.NOT_FOUND, "nothing there")) });
  const picks: string[] = [];
  const deps: RunDeps = {
    registry,
    liveNodes: () => all,
    log: (line) => lines.push(line),
    pick: async ({ title, candidates }) => {
      picks.push(title);
      return pickAnswer(candidates);
    },
  };
  return { deps, calls, lines, picks };
}

test("splitChain: `;` outside quotes splits, a word ending in `;` too; empty parts and a trailing `;` are dropped", () => {
  const texts = (line: string) => splitChain(line).map((p) => p.text);
  assert.deepEqual(texts("mute /Kick; solo /Bass"), ["mute /Kick", "solo /Bass"]);
  assert.deepEqual(texts("mute /Kick ; solo /Bass"), ["mute /Kick", "solo /Bass"]);
  assert.deepEqual(texts("mute /Kick;solo /Bass"), ["mute /Kick", "solo /Bass"]);
  assert.deepEqual(texts("mute /Kick;"), ["mute /Kick"]);
  assert.deepEqual(texts(" ; ;mute /Kick;; ; solo /Bass; "), ["mute /Kick", "solo /Bass"]);
  assert.deepEqual(texts(";"), []);
  assert.deepEqual(texts(""), []);
  assert.deepEqual(texts("one"), ["one"]);
});

test("splitChain: quotes and a backslash keep the `;` as text; an open quote swallows the rest", () => {
  const texts = (line: string) => splitChain(line).map((p) => p.text);
  assert.deepEqual(texts('note "a;b"; mute /Kick'), ['note "a;b"', "mute /Kick"]);
  assert.deepEqual(texts("note 'a;b'; mute /Kick"), ["note 'a;b'", "mute /Kick"]);
  assert.deepEqual(texts("note a\\;b; mute /Kick"), ["note a\\;b", "mute /Kick"]);
  assert.deepEqual(texts('note "a\\";b"; mute /Kick'), ['note "a\\";b"', "mute /Kick"]);
  assert.deepEqual(texts("note 'a\\';b"), ["note 'a\\'", "b"]); // no escapes inside single quotes: the quote closes right after the backslash, so the `;` splits
  assert.deepEqual(texts('note "open; mute /Kick'), ['note "open; mute /Kick']);
});

test("splitChain keeps where each part sits; chainSegments keeps the empty ones", () => {
  const line = "mute /Kick;  solo /Bass ";
  const parts = splitChain(line);
  assert.deepEqual(parts.map((p) => line.slice(p.start, p.end)), ["mute /Kick", "solo /Bass"]);
  assert.deepEqual(chainSegments("a; ;b"), [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }]);
  assert.deepEqual(chainSegments(""), [{ start: 0, end: 0 }]);
});

test("a value holding `;` is quoted when it is written into a line, so it never splits", () => {
  assert.equal(quoteIfNeeded("a;b"), '"a;b"');
  assert.equal(quoteIfNeeded("plain"), "plain");
  assert.deepEqual(splitChain(`note ${quoteIfNeeded("a;b")}`).map((p) => p.text), ['note "a;b"']);
});

test("a chain runs its parts in order; all ok is quiet, one log line per part, and the line is remembered with unique paths", async () => {
  const { deps, calls, lines } = setup();
  const out = await runLine("mute /Bass; solo /Lead", deps);
  assert.deepEqual(calls, ["mute /Bass", "solo /Lead"]);
  assert.equal(out.result.code, ExitCode.OK);
  assert.equal(out.result.message, undefined);
  let shown = 0;
  presentResult(out.result, () => void shown++);
  assert.equal(shown, 0); // silence is success
  assert.equal(out.line, "mute /Bass; solo /Lead");
  const own = lines.filter((l) => /-> 0/.test(l));
  assert.equal(own.length, 3); // each part, then the whole line
  assert.ok(lines.some((l) => l.includes("start: mute /Bass")));
  assert.ok(lines.some((l) => l.includes("start: solo /Lead")));
});

test("the remembered line gives every part's unique paths (a same-named sibling gets #1)", async () => {
  const { deps } = setup();
  const out = await runLine("mute /Kick#1; solo /Lead", deps);
  assert.equal(out.line, "mute /Kick#1; solo /Lead");
  const first = await runLine("mute /Bass;", deps); // a trailing `;` is one command, exactly as without it
  assert.equal(first.line, "mute /Bass");
});

test("a trailing `;`, `mute /Kick#2;` and `;`-only lines behave like their single command", async () => {
  const { deps, calls } = setup();
  const one = await runLine("mute /Kick#2;", deps);
  assert.equal(one.result.code, ExitCode.OK);
  assert.deepEqual(calls, ["mute /Kick#2"]);
  const none = await runLine(" ; ; ", deps); // nothing to run: the command list, like an empty line
  assert.equal(none.result.code, ExitCode.OK);
  assert.match(none.result.message ?? "", /mute/);
});

test("a failing part does not stop the rest; the exit code is the first failure's; the dialog lists every part", async () => {
  const { deps, calls } = setup();
  const out = await runLine("mute /Bass; gone; nope; solo /Lead", deps);
  assert.deepEqual(calls, ["mute /Bass", "gone", "nope", "solo /Lead"]); // all four ran
  assert.equal(out.result.code, ExitCode.NOT_FOUND); // `gone` failed first
  assert.equal(out.result.message, "2 of 4 parts failed");
  let text = "";
  presentResult(out.result, (t) => void (text = t));
  assert.equal(
    text,
    ["cmdAbl: 2 of 4 parts failed", "  ✓ part 1 (mute /Bass)", "  ✓ part 4 (solo /Lead)", "  × part 2 (gone)", "      nothing there", "  × part 3 (nope)", "      no good"].join("\n"),
  );
});

test("a parse error names its part", async () => {
  const { deps } = setup();
  const out = await runLine("mute /Bass; mute --bogus /Lead; solo /Lead", deps);
  assert.equal(out.result.code, ExitCode.USAGE);
  const detail = out.result.details!.find((d) => !d.ok)!;
  assert.equal(detail.path, "part 2 (mute --bogus /Lead)");
  assert.match(detail.message!, /unknown option "--bogus"/);
});

test("a cancelled pick stops the chain; the parts before stay done and nothing is reported", async () => {
  const { deps, calls, picks } = setup(() => null);
  const out = await runLine("mute /Bass; solo kick; mute /Lead", deps);
  assert.equal(picks.length, 1);
  assert.deepEqual(calls, ["mute /Bass"]); // the pick for part 2 was cancelled: parts 2 and 3 did not run
  assert.equal(out.cancelled, true);
  assert.equal(out.result.code, ExitCode.OK);
  assert.equal(out.line, undefined); // not remembered
});

test("a pick that is answered lets the chain go on, in turn", async () => {
  const { deps, calls, picks } = setup((c) => [c[1]!]);
  const out = await runLine("mute kick; solo kick; mute /Bass", deps);
  assert.equal(picks.length, 2);
  assert.deepEqual(calls, ["mute /Kick#2", "solo /Kick#2", "mute /Bass"]);
  assert.equal(out.line, "mute /Kick#2; solo /Kick#2; mute /Bass");
});

test("a cancelled pick after a failed part: the failures are reported, with the cancel noted", async () => {
  const { deps, calls } = setup(() => null);
  const out = await runLine("nope; solo kick; mute /Lead", deps);
  assert.deepEqual(calls, ["nope"]);
  assert.equal(out.cancelled, undefined);
  assert.equal(out.result.code, ExitCode.FAILURE);
  assert.equal(out.result.message, "1 of 3 parts failed (cancelled at part 2)");
  assert.deepEqual(out.result.details!.map((d) => [d.path, d.ok]), [["part 1 (nope)", false], ["part 2 (solo kick)", false]]);
});

test("Tab on a pick list (fill) ends the chain and reopens the palette", async () => {
  const { deps, calls } = setup();
  let fill: string | undefined;
  deps.pick = async () => {
    fill = " /Kick#1";
    return null;
  };
  deps.takeFill = () => {
    const f = fill;
    fill = undefined;
    return f;
  };
  const out = await runLine("mute /Bass; solo kick; mute /Lead", deps);
  assert.equal(out.fill, " /Kick#1");
  assert.deepEqual(calls, ["mute /Bass"]);
});

// ── headless ────────────────────────────────────────────────────────────────────────────────

function headlessSetup() {
  const calls: string[] = [];
  const ui: Ui = { prompt: async () => null, select: async () => null, notify: () => {}, notifyAnswer: async () => null, settings: async () => null, defaults: async () => null, board: async () => null, page: async () => null, livePage: async () => null };
  const gate = createUiGate(ui);
  const registry = new CommandRegistry();
  const named = (name: string): Command["run"] => (inv) => {
    calls.push(`${name} ${(inv.args[0] ?? []).map((v) => (typeof v === "string" ? v : v.path)).join(",")}`.trim());
  };
  registry.add({ name: "mute", summary: "mute", args: [{ name: "t", kind: "path", variadic: true }], run: named("mute") });
  registry.add({ name: "solo", summary: "solo", args: [{ name: "t", kind: "path", variadic: true }], run: named("solo") });
  const log = createLog(() => {}, 100);
  return { gate, calls, deps: { registry, liveNodes: () => all, log: (l: string) => log.record(l) }, log };
}

test("headless chain: an ambiguous part is exit 4 for that part, the others still run", async () => {
  const s = headlessSetup();
  const out = await runHeadless("mute /Bass; solo kick; mute /Lead", s.deps, s.gate, { log: s.log });
  assert.deepEqual(s.calls, ["mute /Bass", "mute /Lead"]);
  assert.equal(out.code, ExitCode.AMBIGUOUS);
  assert.match(out.message, /1 of 3 parts failed/);
  assert.match(out.message, /× part 2 \(solo kick\)/);
  assert.match(out.message, /ambiguous: /);
  assert.match(out.message, /\/Kick#1/);
  assert.match(out.message, /✓ part 1 \(mute \/Bass\)/);
  assert.ok(out.dialogs.length >= 1);
});

test("headless chain: all parts ok is a quiet exit 0; a single ambiguous line stays exit 4 as before", async () => {
  const s = headlessSetup();
  const clean = await runHeadless("mute /Bass; solo /Lead;", s.deps, s.gate, { log: s.log });
  assert.equal(clean.code, ExitCode.OK);
  assert.equal(clean.message, "");
  assert.ok(clean.log.length >= 2);
  const single = await runHeadless("solo kick", s.deps, s.gate, { log: s.log });
  assert.equal(single.code, ExitCode.AMBIGUOUS);
  assert.match(single.message, /^cmdAbl: ambiguous: /);
});
