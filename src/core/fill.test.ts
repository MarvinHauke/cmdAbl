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
