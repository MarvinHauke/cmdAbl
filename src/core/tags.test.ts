import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry } from "./commandRegistry.js";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../ableton/objectTree.js";
import { ExitCode } from "./types.js";
import { runLine, type RunDeps } from "./run.js";
import { parseTagTarget, tagCounts, nodesWithTag, tagSuffix } from "./tags.js";
import { pickNodes, pickTagNames } from "./pick.js";
import type { SelectRequest, Ui } from "./ui.js";

let id = 5000;
const track = (name: string, tags?: string[], children: ObjectNode[] = []): ObjectNode =>
  ({ handleId: String(++id), route: [id], kind: "track", scope: "regular", name, path: "", children, ...(tags ? { tags } : {}) }) as ObjectNode;

// Bass(synth)  SH-101 MIDI(synth, fx)  Opal Lead(fx)  Drums(drum) > Kick(drum, fx) Snare   FX Bus
const roots = [
  track("Bass", ["synth"]),
  track("SH-101 MIDI", ["synth", "fx"]),
  track("Opal Lead", ["fx"]),
  track("Drums", ["drum"], [track("Kick", ["drum", "fx"]), track("Snare")]),
  track("FX Bus"),
];
assignPaths(roots, "");
const all = flattenObjectTree(roots);

function setup(options: { tagAnswer?: string[] | null; pickAnswer?: (c: ObjectNode[]) => ObjectNode[] | null; bridge?: boolean } = {}) {
  const registry = new CommandRegistry();
  const calls: string[][] = [];
  const picks: Array<{ title: string; offered: string[] }> = [];
  const tagLists: Array<{ title: string; tags: string[]; multi: boolean; preview: unknown }> = [];
  registry.add({
    name: "mute",
    summary: "mute",
    args: [{ name: "t", kind: "path", kinds: ["track"], variadic: true }],
    run: (inv) => void calls.push(((inv.args[0] ?? []) as ObjectNode[]).map((n) => n.path)),
  });
  registry.add({ name: "goto", summary: "go", args: [{ name: "p", kind: "path", rest: true }], run: (inv) => void calls.push(((inv.args[0] ?? []) as ObjectNode[]).map((n) => n.path)) });
  const deps: RunDeps = {
    registry,
    liveNodes: () => all,
    log: () => {},
    ...(options.bridge === false ? {} : { bridge: () => ({ available: async () => ({ ok: true as const, value: undefined as never }) }) }),
    pick: async ({ title, candidates }) => {
      picks.push({ title, offered: candidates.map((c) => c.path) });
      return options.pickAnswer ? options.pickAnswer(candidates) : null;
    },
    pickTags: async ({ title, tags, multi, preview }) => {
      tagLists.push({ title, tags: tags.map((t) => `${t.name}:${t.count}`), multi, preview });
      return options.tagAnswer ?? null;
    },
  };
  return { deps, calls, picks, tagLists };
}

test("parseTagTarget: #name, bare #, and everything else", () => {
  assert.deepEqual(parseTagTarget("#FX"), { name: "fx" });
  assert.equal(parseTagTarget("#"), "list");
  for (const text of ["fx", "/Kick#1", "#1 Drums", "#a b", ""]) assert.equal(parseTagTarget(text), null);
});

test("tagCounts / nodesWithTag / tagSuffix", () => {
  assert.deepEqual(tagCounts(all).map((t) => `${t.name}:${t.count}`), ["drum:2", "fx:3", "synth:2"]);
  assert.deepEqual(nodesWithTag(all, "fx").map((n) => n.name), ["SH-101 MIDI", "Opal Lead", "Kick"]);
  assert.equal(tagSuffix(all[1]!), " #synth #fx");
  assert.equal(tagSuffix(all.find((n) => n.name === "FX Bus")!), "");
});

test("#fx: every tagged object at once, no list; also inside a comma list", async () => {
  const s = setup();
  assert.equal((await runLine("mute #fx", s.deps)).result.code, 0);
  assert.deepEqual(s.calls, [["/SH-101 MIDI", "/Opal Lead", "/Drums/Kick"]]);
  assert.equal(s.picks.length + s.tagLists.length, 0);
  const t = setup();
  await runLine("mute #synth, /Drums/Snare", t.deps);
  assert.deepEqual(t.calls, [["/Bass", "/SH-101 MIDI", "/Drums/Snare"]]);
});

test("#fx where nothing is tagged: exit 3 \"no track tagged #nope\"", async () => {
  const s = setup();
  const out = await runLine("mute #nope", s.deps);
  assert.equal(out.result.code, ExitCode.NOT_FOUND);
  assert.equal(out.result.message, "mute: no track tagged #nope");
  assert.deepEqual(s.calls, []);
});

test("bare #: a multi-select list of the Set's tags with counts; the chosen tags' tracks run", async () => {
  const s = setup({ tagAnswer: ["drum", "synth"] });
  const out = await runLine("mute #", s.deps);
  assert.equal(out.result.code, 0);
  assert.deepEqual(s.tagLists[0]!.tags, ["drum:2", "fx:3", "synth:2"]);
  assert.equal(s.tagLists[0]!.multi, true);
  assert.deepEqual(s.calls, [["/Drums", "/Drums/Kick", "/Bass", "/SH-101 MIDI"]]);
});

test("bare # next to other targets keeps them; Esc cancels quietly", async () => {
  const s = setup({ tagAnswer: ["fx"] });
  await runLine("mute /Bass, #", s.deps);
  assert.deepEqual(s.calls, [["/Bass", "/SH-101 MIDI", "/Opal Lead", "/Drums/Kick"]]);
  assert.deepEqual(s.tagLists[0]!.preview, { before: "mute /Bass", after: "" });
  const esc = setup({ tagAnswer: null });
  const out = await runLine("mute #", esc.deps);
  assert.equal(out.cancelled, true);
  assert.deepEqual(esc.calls, []);
});

test("a Set without any tags: bare # is exit 3", async () => {
  const s = setup();
  s.deps.liveNodes = () => flattenObjectTree([track("Bass")]);
  const out = await runLine("mute #", s.deps);
  assert.equal(out.result.code, ExitCode.NOT_FOUND);
  assert.equal(out.result.message, "mute: no tags in the Set");
});

test("script not running: any #… answers exit 5; bare words still work", async () => {
  const down = setup();
  down.deps.bridge = () => ({ available: async () => ({ ok: false as const, code: 5, text: "Remote Script not running" }) });
  for (const line of ["mute #fx", "mute #"]) {
    const out = await runLine(line, down.deps);
    assert.equal(out.result.code, ExitCode.UNAVAILABLE);
    assert.equal(out.result.message, "Remote Script not running");
  }
  assert.equal((await runLine("mute bass", down.deps)).result.code, 0);
  const none = setup({ bridge: false });
  assert.equal((await runLine("mute #fx", none.deps)).result.code, ExitCode.UNAVAILABLE);
});

test("a bare word also lists the objects tagged with it; names come first", async () => {
  const s = setup({ pickAnswer: (c) => c });
  await runLine("mute fx", s.deps); // names: FX Bus; tagged: SH-101 MIDI, Opal Lead, Kick
  assert.deepEqual(s.picks[0]!.offered, ["/FX Bus", "/SH-101 MIDI", "/Opal Lead", "/Drums/Kick"]);
  assert.deepEqual(s.calls, [["/FX Bus", "/SH-101 MIDI", "/Opal Lead", "/Drums/Kick"]]);
  // an exact address stays exact
  const exact = setup({ pickAnswer: (c) => c });
  await runLine("mute /Bass", exact.deps);
  assert.equal(exact.picks.length, 0);
});

test("a single-target command given #fx with several hits still asks", async () => {
  const s = setup({ pickAnswer: (c) => [c[0]!] });
  await runLine("goto #fx", s.deps);
  assert.deepEqual(s.picks[0]!.offered, ["/SH-101 MIDI", "/Opal Lead", "/Drums/Kick"]);
});

test("pick rows show the node's tags next to its kind; the tag list rows carry #name and a count", async () => {
  const requests: SelectRequest[] = [];
  const ui = { select: async (r: SelectRequest) => (requests.push(r), [0]) } as unknown as Ui;
  await pickNodes(ui, { title: "t", candidates: [all[1]!, all.find((n) => n.name === "FX Bus")!], multi: true });
  assert.deepEqual(requests[0]!.items.map((i) => i.detail), ["track #synth #fx", "track"]);
  const names = await pickTagNames(ui, { title: "t", tags: [{ name: "fx", count: 3 }, { name: "solo", count: 1 }], multi: true });
  assert.deepEqual(names, ["fx"]);
  assert.deepEqual(requests[1]!.items, [
    { label: "#fx", detail: "3 tracks", value: "#fx" },
    { label: "#solo", detail: "1 track", value: "#solo" },
  ]);
});

test("refreshTags runs before a #… target is resolved and the tree is re-read afterwards", async () => {
  const s = setup();
  const sets: ObjectNode[][] = [flattenObjectTree([track("Bass")]), all]; // cold: no tags yet; after the refresh: tagged
  let reads = 0;
  s.deps.liveNodes = () => sets[Math.min(reads, 1)]!;
  s.deps.refreshTags = async () => {
    reads++;
    return null;
  };
  assert.equal((await runLine("mute #fx", s.deps)).result.code, 0);
  assert.deepEqual(s.calls, [["/SH-101 MIDI", "/Opal Lead", "/Drums/Kick"]]);
  // a failing refresh ends the run with its own result; bare words never call it
  const down = setup();
  let called = 0;
  down.deps.refreshTags = async () => (called++, { code: ExitCode.UNAVAILABLE, message: "Remote Script not running" });
  const out = await runLine("mute #fx", down.deps);
  assert.equal(out.result.code, ExitCode.UNAVAILABLE);
  await runLine("mute bass", down.deps);
  assert.equal(called, 1);
});

test("tag names compare lower-case on both sides", async () => {
  const mixed = [track("Pad", ["FX"])];
  assignPaths(mixed, "");
  assert.deepEqual(nodesWithTag(flattenObjectTree(mixed), "fx").map((n) => n.name), ["Pad"]);
  assert.deepEqual(tagCounts(flattenObjectTree(mixed)), [{ name: "fx", count: 1 }]);
});

test("joined words that hit stay the reading even when a word is also a tag", async () => {
  // Group Drums holds Kick; Snare is tagged "drums". `mute drums kick`: the joined words hit the track Kick
  // (one hit, no list); the tag only matters for a single bare word.
  const set = [track("Drums", [], [track("Kick"), track("Snare")]), track("Hat", ["drums"])];
  assignPaths(set, "");
  const s = setup();
  s.deps.liveNodes = () => flattenObjectTree(set);
  await runLine("mute drums kick", s.deps);
  assert.deepEqual(s.calls, [["/Drums/Kick"]]);
  assert.equal(s.picks.length, 0);
});

test("an argument with multiple: \"all\" takes every #tag hit without a list, also when not variadic", async () => {
  const s = setup();
  s.deps.registry.add({
    name: "tag",
    summary: "t",
    args: [{ name: "target", kind: "path", kinds: ["track"], multiple: "all" }],
    run: (inv) => void s.calls.push(((inv.args[0] ?? []) as ObjectNode[]).map((n) => n.path)),
  });
  await runLine("tag #fx", s.deps);
  assert.deepEqual(s.calls, [["/SH-101 MIDI", "/Opal Lead", "/Drums/Kick"]]);
  assert.equal(s.picks.length, 0);
});
