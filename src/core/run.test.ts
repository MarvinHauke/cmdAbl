import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry, type Command } from "./commandRegistry.js";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import { ExitCode, fail } from "./types.js";
import { runLine, type RunDeps } from "./run.js";
import { parse } from "./parse.js";
import { pickNodes } from "./pick.js";
import type { SelectRequest } from "./ui.js";
import { parsePickResult } from "./pickResult.js";
import { validateTree } from "./commandTree.js";

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
  const picks: { title: string; multi: boolean; offered: string[]; preview: { before: string; after: string } }[] = [];
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
  const deps: RunDeps = {
    registry,
    liveNodes: () => all,
    pick: async ({ title, candidates, multi, preview }) => {
      picks.push({ title, multi, offered: candidates.map((c) => c.path), preview });
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

test("run: --help", async () => {
  const { deps } = setup();
  const help = await runLine("mute --help", deps);
  assert.match(help.result.message ?? "", /usage: mute \[--pick\] <track>…/);
});

test("registry.add rejects an invalid or duplicate command without throwing", () => {
  const { registry } = setup();
  assert.ok(registry.add({ name: "goto", summary: "again", run: () => {} }).length > 0);
  assert.ok(registry.add({ name: "x", summary: "no run" }).length > 0);
  assert.equal(registry.roots().length, 4);
  assert.deepEqual(registry.list().map((d) => d.name), ["goto", "mute", "boom", "nope"]);
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

test("run: the pick preview splits the line around the ambiguous address", async () => {
  const { deps, picks } = setup((c) => [c[0]!]);
  await runLine('mute "/Opal Lead" "/Vermona DRM Audio" /Kick "/Opal Lead"', deps);
  assert.deepEqual(picks[0]!.preview, {
    before: 'mute "/Opal Lead" "/Vermona DRM Audio"',
    after: "", // the second "/Opal Lead" names an object already listed
  });
});

test("run: resolved targets show as unique paths, unresolved ones as typed", async () => {
  const { deps, picks } = setup((c) => [c[0]!]);
  await runLine("mute /Vermona, /Kick, /Opal", deps);
  // "/Vermona" and "/Kick" are both ambiguous: ONE list answers them; "/Opal" resolves uniquely.
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.title, 'mute: "/Vermona", "/Kick" match 4');
  assert.deepEqual(picks[0]!.preview, { before: "mute", after: '"/Opal Lead"' });
});

test("pickNodes: label is the unique path, value is the quoted unique path", async () => {
  const requests: SelectRequest[] = [];
  const ui = {
    select: async (r: SelectRequest) => (requests.push(r), [0]),
    prompt: async () => null,
    notify: () => {},
    page: async () => null,
  };
  const candidates = all.filter((n) => n.name === "Kick" || n.name === "Vermona DRM Audio");
  const preview = { before: "mute /a", after: "/b" };
  await pickNodes(ui, { title: "t", candidates, multi: true, nodes: all, preview });
  const req = requests[0]!;
  assert.deepEqual(req.preview, preview);
  assert.deepEqual(
    req.items.map((i) => [i.label, i.value]),
    [
      ["/Vermona DRM Audio", '"/Vermona DRM Audio"'],
      ["/Kick#1", "/Kick#1"],
      ["/Kick#2", "/Kick#2"],
    ],
  );
  // Without a preview the field is absent.
  await pickNodes(ui, { title: "t", candidates, multi: false });
  assert.equal("preview" in requests[1]!, false);
});

test("run: preview + chosen values reproduces the remembered line", async () => {
  let offered: ObjectNode[] = [];
  let preview = { before: "", after: "" };
  const { deps } = setup((c) => [c[1]!, c[0]!]);
  const inner = deps.pick;
  deps.pick = async (request) => {
    offered = request.candidates;
    preview = request.preview;
    return inner(request);
  };
  const out = await runLine('mute /Vermona "/Opal Lead"', deps);
  const values = [offered[1]!, offered[0]!].map((n) => (/\s/.test(n.path) ? `"${n.path}"` : n.path));
  assert.equal([preview.before, ...values, preview.after].filter(Boolean).join(" "), out.line);
});

test("run: the remembered line is canonical — unique paths, each object once", async () => {
  const { deps, calls } = setup((c) => [c[0]!]);
  const a = await runLine("mute opal /Opal Lead", deps);
  assert.equal(a.line, 'mute "/Opal Lead"');
  assert.deepEqual(calls[0]!.paths, ["/Opal Lead"]);
  const b = await runLine("mute /Kick#1 kick", deps); // picks Kick#1 for "kick"
  assert.equal(b.line, "mute /Kick#1");
  assert.equal(calls[1]!.paths.length, 1); // the handler got one object
  // A path argument is rewritten; a text argument and an option stay as typed.
  const { deps: d2, registry } = setup();
  const c = await runLine("goto opal", d2);
  assert.equal(c.line, 'goto "/Opal Lead"');
  registry.add({ name: "say", summary: "text", args: [{ name: "word", kind: "text" }], options: [{ name: "to", takesValue: true, summary: "target" }], run: () => {} });
  const d = await runLine('say --to "a b" Hello', d2);
  assert.equal(d.line, 'say --to "a b" Hello'); // re-parses: a quote inside --name= is not a quoted token
  assert.equal((await runLine(d.line!, d2)).line, d.line);
  const dash = await runLine('say "-x"', d2);
  assert.equal(dash.line, 'say "-x"'); // a leading dash is quoted so it re-parses as a word
  assert.equal((await runLine(dash.line!, d2)).result.code, ExitCode.OK);
});

test("run: the preview shows uniquely resolved text as its path, once", async () => {
  const { deps, picks } = setup((c) => [c[0]!]);
  await runLine('mute opal "/Opal Lead" kick vermona', deps);
  // "kick" and "vermona" are ambiguous (one list); opal and "/Opal Lead" are one object.
  assert.equal(picks.length, 1);
  assert.deepEqual(picks[0]!.preview, { before: 'mute "/Opal Lead"', after: "" });
});

test("run: a lone dash inside an unquoted name, and a word equal to a declared flag", async () => {
  const dashed = [node("Kick - Sub", "track"), node("Opal Lead", "track")];
  assignPaths(dashed, "");
  const { deps, calls, registry } = setup();
  deps.liveNodes = () => flattenObjectTree(dashed);
  const out = await runLine("mute /Kick - Sub", deps);
  assert.equal(out.result.code, ExitCode.OK);
  assert.deepEqual(calls[0]!.paths, ["/Kick - Sub"]);
  assert.equal(out.line, 'mute "/Kick - Sub"');
  assert.equal((await runLine(out.line!, deps)).result.code, ExitCode.OK);
  assert.deepEqual(calls[1]!.paths, ["/Kick - Sub"]); // the re-run hits the same track

  registry.add({
    name: "find2",
    summary: "text arg and a flag",
    args: [{ name: "pattern", kind: "text" }],
    options: [{ name: "devices", short: "d", summary: "devices only" }],
    run: () => {},
  });
  const word = await runLine('find2 "-d"', deps);
  assert.equal(word.line, 'find2 "-d"'); // stays a word, not the flag
  const flag = await runLine("find2 -d x", deps);
  assert.equal(flag.line, "find2 --devices x");
});

test("run: one log line per command with the canonical line, exit code and duration", async () => {
  const { deps } = setup((c) => [c[0]!]);
  const lines: string[] = [];
  let clock = 100;
  deps.log = (l) => lines.push(l);
  deps.now = () => (clock += 12);
  await runLine("mute opal", deps);
  await runLine("mute nothing-like-this", deps);
  await runLine("nope", deps);
  assert.deepEqual(lines, [
    "cmdAbl: run start: mute opal",
    'cmdAbl: run: mute "/Opal Lead" -> 0 (12 ms)',
    "cmdAbl: run start: mute nothing-like-this",
    "cmdAbl: run: mute nothing-like-this -> 3 (12 ms)",
    "cmdAbl: run start: nope",
    "cmdAbl: run: nope -> 1 (12 ms)",
  ]);
});

test("run: requires bridge — checked before resolving and picking, handler not called when unavailable", async () => {
  const { createFakeBridge } = await import("../ableton/bridgeFake.js");
  const { deps, calls, picks, registry } = setup((c) => [c[0]!]);
  registry.add({
    name: "needs",
    summary: "needs the Remote Script",
    requires: ["bridge"],
    args: [{ name: "track", kind: "path", kinds: ["track"] }],
    run: (inv) => {
      calls.push({ name: "needs", paths: (inv.args[0] ?? []).map((v) => (typeof v === "string" ? v : v.path)) });
    },
  });

  // Available: runs like any command (including the pick).
  const up = createFakeBridge();
  deps.bridge = () => up;
  const ran = await runLine("needs vermona", deps);
  assert.equal(ran.result.code, ExitCode.OK);
  assert.equal(calls.filter((c) => c.name === "needs").length, 1);
  assert.equal(picks.length, 1);

  // Not running: the bridge's own code and text, no pick, no handler, no history line.
  const down = createFakeBridge({ running: false, unavailableText: "Remote Script not running (fake)" });
  deps.bridge = () => down;
  const refused = await runLine("needs vermona", deps);
  assert.equal(refused.result.code, ExitCode.UNAVAILABLE);
  assert.equal(refused.result.message, "Remote Script not running (fake)");
  assert.equal(refused.line, undefined);
  assert.equal(picks.length, 1, "no new pick");
  assert.equal(calls.filter((c) => c.name === "needs").length, 1, "handler not called again");

  // No bridge wired at all: exit 5, never a throw.
  delete deps.bridge;
  assert.equal((await runLine("needs opal", deps)).result.code, ExitCode.UNAVAILABLE);

  // A command without `requires` never asks the bridge.
  deps.bridge = () => down;
  assert.equal((await runLine("mute opal", deps)).result.code, ExitCode.OK);
  assert.equal(down.calls.length, 0);
});

test("run: a bridge that throws becomes exit 5, not an exception", async () => {
  const { deps, registry } = setup();
  registry.add({ name: "needs2", summary: "x", requires: ["bridge"], run: () => {} });
  deps.bridge = () => ({
    available: async () => {
      throw new Error("socket exploded");
    },
  });
  const out = await runLine("needs2", deps);
  assert.equal(out.result.code, ExitCode.UNAVAILABLE);
  assert.match(out.result.message ?? "", /socket exploded/);
});

test("--help ends with 'more: man <path>' only when a man command exists", async () => {
  const { deps, registry } = setup();
  const without = await runLine("mute --help", deps);
  assert.ok(!String(without.result.message).includes("more:"));
  registry.add({ name: "man", summary: "manual", run: () => {} });
  const withMan = await runLine("mute --help", deps);
  assert.match(String(withMan.result.message), /\nmore: man mute$/);
});
