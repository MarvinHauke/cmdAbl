import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry } from "./commandRegistry.js";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../ableton/objectTree.js";
import { parseSelectAnswer } from "./pickResult.js";
import { pickNodes } from "./pick.js";
import { runLine, type RunDeps } from "./run.js";
import type { SelectRequest, Ui } from "./ui.js";

let id = 5000;
const node = (name: string): ObjectNode => ({
  handleId: String(++id), route: [id], kind: "track", scope: "regular", name, path: "", children: [],
});
const roots = [node("Kick"), node("Kick"), node("Opal Lead")];
assignPaths(roots, "");
const all = flattenObjectTree(roots);

test("parseSelectAnswer: indexes, a fill object, and junk", () => {
  assert.deepEqual(parseSelectAnswer("[2,0]", 3), [2, 0]);
  assert.deepEqual(parseSelectAnswer('{"fill":1}', 3), { fill: 1 });
  assert.equal(parseSelectAnswer('{"fill":3}', 3), null); // out of range
  assert.equal(parseSelectAnswer('{"fill":"x"}', 3), null);
  assert.equal(parseSelectAnswer("", 3), null);
  assert.equal(parseSelectAnswer("not json", 3), null);
});

test("pickNodes: fill is offered only on single-select lists and comes back as the object", async () => {
  const requests: SelectRequest[] = [];
  const ui = {
    select: async (r: SelectRequest) => (requests.push(r), { fill: 1 }),
    prompt: async () => null,
    notify: () => {},
    page: async () => null,
  } satisfies Ui;
  const single = await pickNodes(ui, { title: "t", candidates: all, multi: false, fill: true });
  assert.equal(requests[0]!.fill, true);
  assert.deepEqual(single, { fill: all[1] });
  await pickNodes(ui, { title: "t", candidates: all, multi: true, fill: true });
  assert.equal("fill" in requests[1]!, false); // multi-select keeps Tab = mark
  await pickNodes(ui, { title: "t", candidates: all, multi: false });
  assert.equal("fill" in requests[2]!, false); // not asked for
});

function setup(pick: (deps: { takeFillSet: (text: string) => void }) => void) {
  const registry = new CommandRegistry();
  const ran: string[] = [];
  registry.add({
    name: "goto",
    summary: "go",
    args: [{ name: "path", kind: "path", rest: true }],
    run: (inv) => {
      ran.push(String((inv.args[0]![0] as ObjectNode).path));
    },
  });
  // A command that opens its own pick (like find through api.pick).
  let fillText: string | undefined;
  registry.add({
    name: "findish",
    summary: "f",
    run: () => {
      fillText = ' "/Opal Lead"'; // what extension.ts's pick() does on a Tab answer
      return undefined;
    },
  });
  const logs: string[] = [];
  const deps: RunDeps = {
    registry,
    liveNodes: () => all,
    log: (l) => logs.push(l),
    takeFill: () => {
      const text = fillText;
      fillText = undefined;
      return text;
    },
    pick: async () => {
      pick({ takeFillSet: (t) => (fillText = t) });
      return null; // the platform resolves a fill as a cancelled pick
    },
  };
  return { deps, ran, logs };
}

test("run: Tab on a platform pick ends the command without running it — outcome.fill, no line, log 'filled'", async () => {
  const { deps, ran, logs } = setup((p) => p.takeFillSet(' "/Opal Lead"'));
  const out = await runLine("goto kick", deps); // ambiguous: two Kick tracks
  assert.equal(out.fill, ' "/Opal Lead"');
  assert.equal(out.cancelled, true);
  assert.equal(out.line, undefined); // nothing is remembered
  assert.deepEqual(ran, []);
  assert.match(logs.at(-1)!, /^cmdAbl: run: goto kick -> filled \(/);
});

test("run: a fill answered inside a handler's own pick ends the run the same way", async () => {
  const { deps, logs } = setup(() => {});
  const out = await runLine("findish", deps);
  assert.equal(out.fill, ' "/Opal Lead"');
  assert.equal(out.line, undefined);
  assert.match(logs.at(-1)!, /findish -> filled/);
});

test("run: without a fill the flow is as before (cancel → cancelled, no fill)", async () => {
  const { deps } = setup(() => {});
  const out = await runLine("goto kick", deps);
  assert.equal(out.cancelled, true);
  assert.equal(out.fill, undefined);
});

test("run: a handler that fails after a fill keeps its failure; the fill is dropped", async () => {
  const registry = new CommandRegistry();
  registry.add({ name: "bad", summary: "b", run: () => ({ code: 1, message: "bad: kaput" }) });
  let fill: string | undefined = " x";
  const out = await runLine("bad", {
    registry,
    liveNodes: () => all,
    log: () => {},
    takeFill: () => {
      const t = fill;
      fill = undefined;
      return t;
    },
    pick: async () => null,
  });
  assert.equal(out.fill, undefined);
  assert.equal(out.result.code, 1);
  assert.equal(fill, undefined); // consumed, so it cannot reach the next command
});

// ── state symbols ───────────────────────────────────────────────────────────

test("pickNodes: state values become row symbols; none known → no state field at all", async () => {
  const requests: SelectRequest[] = [];
  const ui = {
    select: async (r: SelectRequest) => (requests.push(r), [0]),
    prompt: async () => null,
    notify: () => {},
    page: async () => null,
  } satisfies Ui;
  await pickNodes(ui, { title: "t", candidates: all, multi: true, state: { label: "muted", values: [true, false, null] } });
  assert.deepEqual(requests[0]!.state, { label: "muted" });
  assert.deepEqual(requests[0]!.items.map((i) => i.state), ["on", "off", undefined]);
  await pickNodes(ui, { title: "t", candidates: all, multi: true, state: { label: "muted", values: [null, null, null] } });
  assert.equal("state" in requests[1]!, false);
  assert.ok(requests[1]!.items.every((i) => !("state" in i)));
});

function stateSetup(read: () => Promise<Array<boolean | null>>, cap = 50, change?: (inv: any) => any) {
  const registry = new CommandRegistry();
  const seen: unknown[] = [];
  registry.add({
    name: "mute",
    summary: "m",
    options: [{ name: "set", takesValue: true, choices: ["0", "1"], summary: "state" }],
    args: [{ name: "track", kind: "path", variadic: true }],
    pickState: { label: "muted", read: async () => read(), ...(change ? { change } : {}) },
    run: () => {},
  });
  const deps: RunDeps = {
    registry,
    liveNodes: () => all,
    log: () => {},
    stateCapMs: cap,
    pick: async (request) => {
      seen.push(request.state);
      return null;
    },
  };
  return { deps, seen };
}

test("run: a pick list for a command with pickState carries the read state (also with --set)", async () => {
  const { deps, seen } = stateSetup(async () => [true, false]);
  await runLine("mute --set 0 kick", deps); // two Kick tracks → ambiguity list
  assert.deepEqual(seen, [{ label: "muted", values: [true, false] }]);
});

test("run: pickState.change reaches the request; a throw or odd value means no preview", async () => {
  const withSet = stateSetup(async () => [true, false], 50, (inv) => (inv.options.set === undefined ? "toggle" : inv.options.set === "1" ? "on" : "off"));
  await runLine("mute kick", withSet.deps);
  await runLine("mute --set 1 kick", withSet.deps);
  await runLine("mute --set 0 kick", withSet.deps);
  assert.deepEqual(withSet.seen, [
    { label: "muted", values: [true, false], change: "toggle" },
    { label: "muted", values: [true, false], change: "on" },
    { label: "muted", values: [true, false], change: "off" },
  ]);
  for (const bad of [() => { throw new Error("x"); }, () => "flip"]) {
    const { deps, seen } = stateSetup(async () => [true, false], 50, bad);
    await runLine("mute kick", deps);
    assert.deepEqual(seen, [{ label: "muted", values: [true, false] }]);
  }
});

test("pick: state.change goes into SelectRequest.state", async () => {
  const requests: SelectRequest[] = [];
  const ui = { select: async (r: SelectRequest) => (requests.push(r), null) } as unknown as Ui;
  await pickNodes(ui, { title: "t", candidates: all, multi: true, state: { label: "muted", values: [true, false, null], change: "toggle" } });
  assert.deepEqual(requests[0]!.state, { label: "muted", change: "toggle" });
});

test("run: a failing, wrong-length or too slow read means no symbols — never an error, never a long wait", async () => {
  for (const read of [
    async () => {
      throw new Error("bridge down");
    },
    async () => [true], // wrong length
    () => new Promise<Array<boolean | null>>(() => {}), // never answers
  ]) {
    const { deps, seen } = stateSetup(read, 30);
    const started = Date.now();
    const out = await runLine("mute kick", deps);
    assert.equal(seen[0], undefined);
    assert.equal(out.cancelled, true); // the pick was answered (cancelled) as usual
    assert.ok(Date.now() - started < 1000);
  }
});

test("run: the direct path never reads state", async () => {
  let reads = 0;
  const { deps } = stateSetup(async () => (reads++, [true]));
  await runLine("mute /Opal Lead", deps); // one object: no list
  assert.equal(reads, 0);
});
