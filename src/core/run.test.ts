import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry, type Command } from "../commandRegistry.js";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import { ExitCode, fail } from "../types.js";
import { runLine, type RunDeps } from "./run.js";
import { parse } from "./parse.js";
import { parsePickResult } from "./pickResult.js";
import { validateTree } from "./commandTree.js";
import { MatchList, matchesPattern } from "../modules/find/matches.js";

let id = 0;
const node = (name: string, kind: "track" | "device", children: ObjectNode[] = []): ObjectNode => ({
  handleId: String(++id),
  route: [id],
  kind,
  scope: "regular",
  name,
  path: "",
  children,
});

// Vermona MIDI(+Vermona DRM device)   Vermona DRM Audio   Opal Lead   Kick   Kick
const roots = [
  node("Vermona MIDI", "track", [node("Vermona DRM", "device")]),
  node("Vermona DRM Audio", "track"),
  node("Opal Lead", "track"),
  node("Kick", "track"),
  node("Kick", "track"),
];
assignPaths(roots, "");
const all = flattenObjectTree(roots);

function setup(pickAnswer: (candidates: ObjectNode[], multi: boolean) => ObjectNode[] | null = () => null) {
  const registry = new CommandRegistry();
  const calls: { name: string; paths: string[] }[] = [];
  const picks: { title: string; multi: boolean; offered: string[] }[] = [];
  const record = (name: string): Command["run"] => (inv) => {
    calls.push({ name, paths: (inv.args[0] ?? []).map((v) => (typeof v === "string" ? v : v.path)) });
  };
  registry.add({ name: "goto", summary: "go", args: [{ name: "path", kind: "path", rest: true }], run: record("goto") });
  registry.add({
    name: "mute",
    summary: "mute",
    args: [{ name: "track", kind: "path", kinds: ["track"], variadic: true }],
    run: record("mute"),
  });
  registry.add({ name: "boom", summary: "throws", run: () => { throw new Error("kaput"); } });
  registry.add({ name: "nope", summary: "fails", run: () => fail(ExitCode.FAILURE, "no") });
  registry.register("legacy", "old style", (flags) => {
    calls.push({ name: "legacy", paths: flags });
  });
  const deps: RunDeps = {
    registry,
    liveNodes: () => all,
    pick: async ({ title, candidates, multi }) => {
      picks.push({ title, multi, offered: candidates.map((c) => c.path) });
      return pickAnswer(candidates, multi);
    },
  };
  return { deps, calls, picks, registry };
}

test("run: a unique path goes straight to the handler, resolved", async () => {
  const { deps, calls, picks } = setup();
  const out = await runLine("goto /Opal Lead", deps); // unquoted space, single target
  assert.equal(out.result.code, ExitCode.OK);
  assert.deepEqual(calls, [{ name: "goto", paths: ["/Opal Lead"] }]);
  assert.equal(picks.length, 0);
  assert.equal(out.line, 'goto "/Opal Lead"');
});

test("run: an ambiguous single target asks once, single-select", async () => {
  const { deps, calls, picks } = setup((c) => [c[1]!]);
  const out = await runLine("goto vermona", deps);
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.multi, false);
  assert.deepEqual(picks[0]!.offered, ["/Vermona MIDI", "/Vermona MIDI/Vermona DRM", "/Vermona DRM Audio"]);
  assert.deepEqual(calls, [{ name: "goto", paths: ["/Vermona MIDI/Vermona DRM"] }]);
  assert.equal(out.line, 'goto "/Vermona MIDI/Vermona DRM"');
});

test("run: a multi-target command offers multi-select, limited to its kinds", async () => {
  const { deps, calls, picks } = setup((c) => [c[0]!, c[1]!]);
  const out = await runLine("mute vermona", deps);
  assert.equal(picks[0]!.multi, true);
  assert.deepEqual(picks[0]!.offered, ["/Vermona MIDI", "/Vermona DRM Audio"]); // tracks only
  assert.deepEqual(calls, [{ name: "mute", paths: ["/Vermona MIDI", "/Vermona DRM Audio"] }]);
  assert.equal(out.line, 'mute "/Vermona MIDI" "/Vermona DRM Audio"');
});

test("run: duplicates are disambiguated in the remembered line", async () => {
  const { deps, calls } = setup((c) => [c[0]!]);
  const out = await runLine("mute /Kick", deps);
  assert.deepEqual(calls, [{ name: "mute", paths: ["/Kick"] }]);
  assert.equal(out.line, "mute /Kick#1");
  const again = await runLine(out.line!, setup().deps); // re-run needs no pick
  assert.equal(again.result.code, ExitCode.OK);
});

test("run: cancelling the pick runs nothing", async () => {
  const { deps, calls } = setup(() => null);
  const out = await runLine("goto vermona", deps);
  assert.equal(out.cancelled, true);
  assert.deepEqual(calls, []);
});

test("run: several targets — unquoted names, comma form, mixed pick", async () => {
  let s = setup();
  await runLine("mute /Opal Lead", s.deps);
  assert.deepEqual(s.calls[0]!.paths, ["/Opal Lead"]);

  s = setup();
  await runLine("mute /Opal Lead, /Kick#2", s.deps);
  assert.deepEqual(s.calls[0]!.paths, ["/Opal Lead", "/Kick#2"]);

  s = setup((c) => [c[0]!]);
  await runLine('mute "/Opal Lead" vermona', s.deps);
  assert.deepEqual(s.calls[0]!.paths, ["/Opal Lead", "/Vermona MIDI"]);
});

test("run: not found, usage, handler failures and exceptions become results", async () => {
  const { deps } = setup();
  assert.equal((await runLine("goto /nope", deps)).result.code, ExitCode.NOT_FOUND);
  assert.equal((await runLine("goto", deps)).result.code, ExitCode.USAGE);
  assert.equal((await runLine("frobnicate", deps)).result.code, ExitCode.NOT_FOUND);
  assert.equal((await runLine("nope", deps)).result.code, ExitCode.FAILURE);
  const boom = await runLine("boom", deps);
  assert.equal(boom.result.code, ExitCode.FAILURE);
  assert.match(boom.result.message ?? "", /kaput/);
});

test("run: --help and legacy commands", async () => {
  const { deps, calls } = setup();
  const help = await runLine("mute --help", deps);
  assert.match(help.result.message ?? "", /usage: mute <track>…/);
  const out = await runLine("legacy --setup  x", deps);
  assert.deepEqual(calls, [{ name: "legacy", paths: ["--setup", "x"] }]);
  assert.equal(out.line, "legacy --setup  x");
});

test("registry.add rejects an invalid or duplicate command without throwing", () => {
  const { registry } = setup();
  assert.ok(registry.add({ name: "goto", summary: "again", run: () => {} }).length > 0);
  assert.ok(registry.add({ name: "legacy", summary: "clash", run: () => {} }).length > 0);
  assert.ok(registry.add({ name: "x", summary: "no run" }).length > 0);
  assert.equal(registry.roots().length, 4);
});

test("parse: a rest argument takes the remaining words as one value", () => {
  const tree: Command[] = [{ name: "goto", summary: "s", args: [{ name: "p", kind: "path", rest: true }], run: () => {} }];
  const r = parse("goto /Vermona MIDI/Vermona DRM", tree);
  assert.ok(r.kind === "run");
  assert.deepEqual(r.invocation.args, [["/Vermona MIDI/Vermona DRM"]]);
  assert.match(
    validateTree([{ name: "x", summary: "s", run: () => {}, args: [{ name: "a", kind: "text", rest: true, variadic: true }] }]).join(),
    /both rest and variadic/,
  );
});

test("uniquePath: the first of same-named siblings gets an explicit #1", () => {
  const kicks = all.filter((n) => n.name === "Kick");
  assert.equal(uniquePath(all, kicks[0]!), "/Kick#1");
  assert.equal(uniquePath(all, kicks[1]!), "/Kick#2");
  assert.equal(uniquePath(all, all[0]!), "/Vermona MIDI");
});

test("parsePickResult", () => {
  const items = ["a", "b", "c"];
  assert.deepEqual(parsePickResult("[2,0]", items), ["c", "a"]);
  assert.equal(parsePickResult("", items), null);
  assert.equal(parsePickResult("[9]", items), null);
  assert.equal(parsePickResult("not json", items), null);
});

test("MatchList: next/prev wrap around", () => {
  const list = new MatchList();
  assert.equal(list.step(1), undefined);
  list.set(["a", "b", "c"]);
  assert.deepEqual(list.step(1), { path: "a", position: 1 });
  assert.deepEqual(list.step(1), { path: "b", position: 2 });
  assert.deepEqual(list.step(-1), { path: "a", position: 1 });
  assert.deepEqual(list.step(-1), { path: "c", position: 3 });
  list.set(["a", "b", "c"], 1); // "b" was already chosen
  assert.deepEqual(list.step(1), { path: "c", position: 3 });
  list.set(["a", "b"]);
  assert.deepEqual(list.step(-1), { path: "b", position: 2 });
});

test("matchesPattern: every word must occur, any order, ignoring case", () => {
  assert.equal(matchesPattern("/Vermona MIDI/Drum Rack/Kick", "vermona kick"), true);
  assert.equal(matchesPattern("/Vermona MIDI/Drum Rack/Kick", "KICK vermona"), true);
  assert.equal(matchesPattern("/Vermona MIDI/Drum Rack/Kick", "vermona snare"), false);
  assert.equal(matchesPattern("/Vermona MIDI", "  "), false);
});
