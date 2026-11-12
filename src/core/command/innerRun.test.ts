import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry, type Command } from "./commandRegistry.js";
import { callStore, innerRun, refusal, sanitizeRuns, type CallCtx, type InnerDeps } from "./innerRun.js";
import { runLine } from "./run.js";
import { ExitCode, ok, type CommandResult } from "../types.js";

const run = () => undefined;
const roots: Command[] = [
  { name: "find", summary: "find", aliases: ["f"], args: [{ name: "t", kind: "text", variadic: true }], run },
  { name: "mute", summary: "mute", args: [{ name: "t", kind: "text", variadic: true }], run },
  { name: "pakabl", summary: "pakabl", children: [{ name: "list", summary: "list", run }, { name: "install", summary: "install", outside: true, args: [{ name: "id", kind: "text" }], run }] },
  { name: "tag", summary: "tag", runs: ["find", "f", "pakabl install", "pakabl list", "tag -e", "ghost"], run },
];

function setup(runs: string[] | null = ["find", "mute", "pakabl list"]) {
  const ran: string[] = [];
  const logged: string[] = [];
  const warned: string[] = [];
  const deps: InnerDeps = {
    roots: () => roots,
    exec: async (line) => (ran.push(`${line}|inner=${callStore.getStore()?.inner}`), ok("done")),
    log: (l) => logged.push(l),
    warn: (t) => warned.push(t),
  };
  const ctx: CallCtx = { path: "tag", line: "tag -l", ...(runs ? { runs } : {}), inner: false, live: { on: true } };
  return { ran, logged, warned, deps, ctx };
}

test("innerRun: a listed line runs, carries the inner flag, and the log marks the caller", async () => {
  const s = setup();
  const r = await innerRun("find #drums", { ctx: s.ctx }, s.deps);
  assert.equal(r.code, 0);
  assert.deepEqual(s.ran, ["find #drums|inner=true"]);
  assert.deepEqual(s.logged, ["cmdAbl [run] info: run: find #drums -> 0 (from tag -l)"]);
});

test("innerRun: the typed alias counts as its command; a chain needs every part listed", async () => {
  const s = setup();
  assert.equal((await innerRun("f #a", { ctx: s.ctx }, s.deps)).code, 0);
  assert.equal((await innerRun("find #a; mute #b", { ctx: s.ctx }, s.deps)).code, 0);
  assert.equal((await innerRun("find #a; pakabl install x", { ctx: s.ctx }, s.deps)).code, ExitCode.USAGE);
  assert.equal(s.ran.length, 2);
});

test("innerRun: unlisted, bare |, junk and empty lines are exit 2 with a warn line, nothing runs", async () => {
  const s = setup();
  for (const line of ["solo #a", "find #a | x", "nonsense", "", "pakabl"]) {
    const r = await innerRun(line, { ctx: s.ctx }, s.deps);
    assert.equal(r.code, ExitCode.USAGE, line);
  }
  assert.equal(s.ran.length, 0);
  assert.equal(s.warned.length, 5);
});

test("innerRun: an outside command is refused even when the list names it", async () => {
  const s = setup(["pakabl install", "find"]);
  const r = await innerRun("pakabl install x", { ctx: s.ctx }, s.deps);
  assert.equal(r.code, ExitCode.USAGE);
  assert.match(r.message ?? "", /outside/);
  assert.equal(s.ran.length, 0);
});

test("innerRun: no caller, a finished caller, an inner caller and no declared runs are refused", async () => {
  const s = setup();
  assert.equal((await innerRun("find #a", { ctx: undefined }, s.deps)).code, ExitCode.USAGE);
  assert.equal((await innerRun("find #a", { ctx: { ...s.ctx, live: { on: false } } }, s.deps)).code, ExitCode.USAGE);
  assert.match((await innerRun("find #a", { ctx: { ...s.ctx, inner: true } }, s.deps)).message ?? "", /nesting/);
  assert.match((await innerRun("find #a", { ctx: setup(null).ctx }, s.deps)).message ?? "", /declares no runs/);
  assert.match((await innerRun("find #a", { ctx: setup([]).ctx }, s.deps)).message ?? "", /declares no runs/);
  assert.equal(s.ran.length, 0);
});

test("innerRun: a call's list only narrows the command's runs", async () => {
  const s = setup(["find", "mute"]);
  assert.equal((await innerRun("find #a", { ctx: s.ctx, narrow: ["find"] }, s.deps)).code, 0);
  assert.equal((await innerRun("mute #a", { ctx: s.ctx, narrow: ["find"] }, s.deps)).code, ExitCode.USAGE);
  assert.equal((await innerRun("solo #a", { ctx: s.ctx, narrow: ["find", "solo"] }, s.deps)).code, ExitCode.USAGE); // cannot widen
  assert.equal((await innerRun("find #a", { ctx: s.ctx, narrow: [] }, s.deps)).code, ExitCode.USAGE);
});

test("innerRun: a page narrows the declared runs, has no list of its own without them, and the log names the page", async () => {
  const s = setup(["find", "mute"]);
  assert.equal((await innerRun("find #a", { ctx: s.ctx, narrow: ["find"], page: "note" }, s.deps)).code, 0);
  assert.equal((await innerRun("mute #a", { ctx: s.ctx, narrow: ["find"], page: "note" }, s.deps)).code, ExitCode.USAGE);
  assert.match(s.logged[0]!, /\(from page note\)/);
  const none = setup(null);
  assert.equal((await innerRun("find #a", { ctx: none.ctx, narrow: ["find"], page: "note" }, none.deps)).code, ExitCode.USAGE); // no exception any more
});

test("innerRun: a throwing exec is a failure, never a throw", async () => {
  const s = setup();
  s.deps.exec = async () => { throw new Error("boom"); };
  assert.equal((await innerRun("find #a", { ctx: s.ctx }, s.deps)).code, ExitCode.FAILURE);
});

test("refusal: outside is refused whatever the list says", () => {
  assert.match(refusal("pakabl install x", ["pakabl install"], roots)!, /outside/);
  assert.equal(refusal("pakabl list", ["pakabl list"], roots), null);
});

test("sanitizeRuns: options, unknown paths and outside commands are dropped with a warning; aliases become names", () => {
  const fresh: Command[] = roots.map((r) => ({ ...r, runs: r.runs ? [...r.runs] : undefined }));
  const warned: string[] = [];
  sanitizeRuns(fresh, (t) => warned.push(t));
  assert.deepEqual(fresh.find((n) => n.name === "tag")!.runs, ["find", "pakabl list"]);
  assert.equal(warned.length, 3); // "pakabl install" (outside), "tag -e" (option), "ghost" (unknown); "f" folds into "find"
  assert.ok(warned.some((w) => /option/.test(w)) && warned.some((w) => /outside/.test(w)) && warned.some((w) => /no runnable/.test(w)));
});

test("runLine carries the running command: a handler sees its path, line and runs; nothing is left after it returns", async () => {
  const registry = new CommandRegistry();
  let seen: CallCtx | undefined;
  registry.add({ name: "ask", summary: "ask", options: [{ name: "flag", short: "f", summary: "f" }], runs: ["find"], run: (): CommandResult => { seen = callStore.getStore(); return ok(); } });
  const result = await runLine("ask --flag", { registry, liveNodes: () => [], pick: async () => null, log: () => {} });
  assert.equal(result.result.code, 0);
  assert.equal(seen?.path, "ask");
  assert.equal(seen?.line, "ask --flag");
  assert.deepEqual(seen?.runs, ["find"]);
  assert.equal(seen?.inner, false);
  assert.equal(seen?.live.on, false); // returned: a late call is refused
  assert.equal(callStore.getStore(), undefined);
});

test("innerRun: a default command is expanded before the check, so it cannot smuggle in a part that was not allowed", async () => {
  const s = setup(["find", "mute"]);
  s.deps.defaults = async () => ({ mute: "mute #a; pakabl install x", find: "find #drums" });
  const bad = await innerRun("mute", { ctx: s.ctx }, s.deps);
  assert.equal(bad.code, ExitCode.USAGE);
  assert.equal(s.ran.length, 0);
  const good = await innerRun("find", { ctx: s.ctx }, s.deps);
  assert.equal(good.code, 0);
  assert.deepEqual(s.ran, ["find #drums|inner=true"]); // the expanded line runs
  assert.ok(s.logged.some((l) => l.includes("find ⇒ find #drums (default)")));
  s.deps.defaults = async () => { throw new Error("broken"); };
  assert.equal((await innerRun("find #a", { ctx: s.ctx }, s.deps)).code, 0); // a broken store means none
});
