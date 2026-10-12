import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry } from "./commandRegistry.js";
import { assignPaths, flattenObjectTree, type ObjectNode } from "../ableton/objectTree.js";
import { ExitCode } from "./types.js";
import { runLine, type RunDeps } from "./run.js";
import { parse } from "./parse.js";

let id = 1000;
const node = (name: string, kind: "track" | "device", children: ObjectNode[] = []): ObjectNode => ({
  handleId: String(++id),
  route: [id],
  kind,
  scope: "regular",
  name,
  path: "",
  children,
});

// Vermona MIDI(+ Drum Rack(+ Kick, Snare))   Drums   Kick   Snare
const roots = [
  node("Vermona MIDI", "track", [node("Drum Rack", "device", [node("Kick", "device"), node("Snare", "device")])]),
  node("Drums", "track"),
  node("Kick", "track"),
  node("Snare", "track"),
];
assignPaths(roots, "");
const all = flattenObjectTree(roots);

// A Set with no track named Kick: "kick" only exists as a pad.
const rootsB = [
  node("Vermona MIDI", "track", [node("Drum Rack", "device", [node("Kick", "device")])]),
  node("Opal Lead", "track"),
];
assignPaths(rootsB, "");
const allB = flattenObjectTree(rootsB);

// A group "Drums" holding the tracks Kick and Snare; a group "Snare Drums" holding "Kick 2".
const rootsC = [
  node("Drums", "track", [node("Kick", "track"), node("Snare", "track")]),
  node("Snare Drums", "track", [node("Kick 2", "track")]),
];
assignPaths(rootsC, "");
const allC = flattenObjectTree(rootsC);

// Typos: tracks only.
const rootsD = [node("Vermona MIDI", "track"), node("Opal Lead", "track"), node("Kick", "track")];
assignPaths(rootsD, "");
const allD = flattenObjectTree(rootsD);

function setup(
  pickAnswer: (candidates: ObjectNode[]) => ObjectNode[] | null = () => null,
  liveNodes: ObjectNode[] = all,
) {
  const registry = new CommandRegistry();
  const calls: string[][] = [];
  const picks: { title: string; offered: string[]; details?: string[] }[] = [];
  const record = (inv: { args: unknown[][] }) => {
    calls.push((inv.args[0] ?? []).map((v) => (typeof v === "string" ? v : (v as ObjectNode).path)));
  };
  // `sel`: any kind of object (like a command without `kinds`); `mute`: tracks only.
  registry.add({ name: "sel", summary: "select", args: [{ name: "o", kind: "path", variadic: true }], run: record });
  registry.add({ name: "mute", summary: "mute", args: [{ name: "t", kind: "path", kinds: ["track"], variadic: true }], run: record });
  registry.add({ name: "goto", summary: "go", args: [{ name: "path", kind: "path", rest: true }], run: record });
  const deps: RunDeps = {
    registry,
    liveNodes: () => liveNodes,
    pick: async ({ title, candidates, details }) => {
      picks.push({ title, offered: candidates.map((c) => c.path), details });
      return pickAnswer(candidates);
    },
  };
  return { deps, calls, picks };
}

test("`mute vermona kick` where only the pad is named kick: tracks hold no \"kick\", so the joined reading is the only one", async () => {
  // kinds: track — "kick" alone finds no track; "vermona kick" finds no track either, so each word
  // is its own target and "kick" is not found.
  const s = setup(() => null, allB);
  const out = await runLine("mute vermona kick", s.deps);
  assert.equal(out.result.code, ExitCode.NOT_FOUND);
});

test("no kinds: both readings of `sel vermona kick` are offered, the joined hit first", async () => {
  const s = setup((c) => [c[0]!], allB);
  const out = await runLine("sel vermona kick", s.deps);
  assert.equal(out.result.code, 0);
  assert.equal(s.picks.length, 1);
  assert.equal(s.picks[0]!.offered[0], "/Vermona MIDI/Drum Rack/Kick");
  assert.deepEqual(s.calls, [["/Vermona MIDI/Drum Rack/Kick"]]);
  assert.equal(out.line, 'sel "/Vermona MIDI/Drum Rack/Kick"');
});

test("two readings (group + child): one pick list, joined hits first, rows say what they matched", async () => {
  const s = setup((c) => c, allC);
  const out = await runLine("mute drums kick", s.deps);
  assert.equal(s.picks.length, 1);
  assert.equal(s.picks[0]!.title, 'mute: "drums kick" matches 3');
  assert.equal(s.picks[0]!.offered[0], "/Drums/Kick"); // the joined reading first
  assert.deepEqual(s.picks[0]!.details?.[0], '"drums kick"');
  assert.ok(s.picks[0]!.offered.includes("/Drums")); // the other reading: group and ...
  assert.ok(s.picks[0]!.offered.includes("/Snare Drums/Kick 2")); // ... every "kick"
  assert.equal(out.result.code, 0);
  // choosing replaces the whole text; the remembered line is canonical
  assert.equal(out.line?.startsWith("mute "), true);
});

test("two readings: marking the group and the child runs both", async () => {
  const s = setup((c) => c.filter((n) => n.path === "/Drums" || n.path === "/Drums/Kick"), allC);
  await runLine("mute drums kick", s.deps);
  assert.deepEqual([...s.calls[0]!].sort(), ["/Drums", "/Drums/Kick"]);
});

test("two readings: a group \"Snare Drums\" with \"Kick 2\" — `mute kick snare` asks, not decides", async () => {
  const s = setup(() => null, allC);
  const out = await runLine("mute kick snare", s.deps);
  assert.equal(s.picks.length, 1); // asked
  assert.equal(out.cancelled, true); // Esc: nothing ran
  assert.deepEqual(s.calls, []);
});

test("`mute kick snare` still names two tracks (no path holds both words)", async () => {
  const s = setup();
  const out = await runLine("mute kick snare", s.deps);
  assert.equal(out.result.code, 0);
  // Each word is its own target: the Kick track and the Snare track (the pads are not tracks).
  assert.deepEqual(s.calls, [["/Kick", "/Snare"]]);
});

test("`sel kick snare`: no path holds both words, so two targets (each word names its track exactly)", async () => {
  const s = setup();
  await runLine("sel kick snare", s.deps);
  assert.deepEqual(s.calls, [["/Kick", "/Snare"]]);
});

test("several hits for the joined words ask once", async () => {
  const s = setup((c) => [c[0]!]);
  await runLine("sel drum rack", s.deps); // Drum Rack and its two pads; "drum" alone also finds Drums
  assert.equal(s.picks.length, 1);
  assert.deepEqual(s.picks[0]!.offered.slice(0, 3), [
    "/Vermona MIDI/Drum Rack",
    "/Vermona MIDI/Drum Rack/Kick",
    "/Vermona MIDI/Drum Rack/Snare",
  ]);
  assert.equal(s.picks[0]!.offered[3], "/Drums");
});

test("a comma always separates targets", async () => {
  const s = setup();
  await runLine("mute drums, kick", s.deps);
  assert.deepEqual(s.calls, [["/Drums", "/Kick"]]);
});

test("a `/` word and a quoted word each start their own target", async () => {
  let s = setup();
  await runLine("mute /Drums /Kick", s.deps);
  assert.deepEqual(s.calls, [["/Drums", "/Kick"]]);
  s = setup();
  await runLine('mute "Drums" snare', s.deps); // quoted word is its own target; "snare" another
  assert.deepEqual(s.calls, [["/Drums", "/Snare"]]);
  s = setup();
  await runLine("mute /Vermona MIDI /Kick", s.deps); // bare word completes the `/` word's path
  assert.deepEqual(s.calls, [["/Vermona MIDI", "/Kick"]]);
});

test("a single-target argument follows the same word rule: `goto vermona kick`", async () => {
  const s = setup(() => null, allB);
  const out = await runLine("goto vermona kick", s.deps);
  assert.equal(out.result.code, 0);
  assert.deepEqual(s.calls, [["/Vermona MIDI/Drum Rack/Kick"]]);
});

test("parse: quoted flags run parallel to the args", () => {
  const parsed = parse<void>('mute "Drums" snare', [
    { name: "mute", summary: "m", args: [{ name: "t", kind: "path", variadic: true }], run: () => {} },
  ]);
  assert.equal(parsed.kind, "run");
  if (parsed.kind === "run") assert.deepEqual(parsed.quoted, [[true, false]]);
});

test("did you mean: a typo opens a suggestion list; the chosen target runs and is remembered", async () => {
  const s = setup((c) => [c[0]!], allD);
  const out = await runLine("mute vermoan", s.deps);
  assert.equal(s.picks.length, 1);
  assert.equal(s.picks[0]!.title, 'mute: nothing matches "vermoan" — did you mean');
  assert.deepEqual(s.picks[0]!.offered, ["/Vermona MIDI"]);
  assert.equal(out.result.code, 0);
  assert.deepEqual(s.calls, [["/Vermona MIDI"]]);
  assert.equal(out.line, 'mute "/Vermona MIDI"');
});

test("did you mean: Esc ends with today's failure — exit 3, nothing remembered", async () => {
  const s = setup(() => null, allD);
  const out = await runLine("mute vermoan", s.deps);
  assert.equal(out.result.code, ExitCode.NOT_FOUND);
  assert.equal(out.result.message, 'mute: nothing matches "vermoan"');
  assert.equal(out.cancelled, undefined);
  assert.equal(out.line, undefined);
  assert.deepEqual(s.calls, []);
});

test("did you mean: no plausible candidate (or a word too short) fails at once, nothing asked", async () => {
  let s = setup((c) => c, allD);
  assert.equal((await runLine("mute zzzzzz", s.deps)).result.code, ExitCode.NOT_FOUND);
  assert.equal(s.picks.length, 0);
  s = setup((c) => c, allD);
  assert.equal((await runLine("mute vm", s.deps)).result.code, ExitCode.NOT_FOUND);
  assert.equal(s.picks.length, 0);
});

test("did you mean: a lone fuzzy hit is still asked about, never run unasked", async () => {
  const s = setup((c) => c, allD);
  await runLine("mute opel", s.deps);
  assert.equal(s.picks.length, 1);
  assert.deepEqual(s.picks[0]!.offered, ["/Opal Lead"]);
});

test("did you mean: several missing texts share one list, rows say which text they are for", async () => {
  const s = setup((c) => c, allD);
  const out = await runLine("mute vermoan, opel", s.deps);
  assert.equal(s.picks.length, 1);
  assert.equal(s.picks[0]!.title, 'mute: nothing matches "vermoan", "opel" — did you mean');
  assert.deepEqual(s.picks[0]!.offered, ["/Vermona MIDI", "/Opal Lead"]);
  assert.deepEqual(s.picks[0]!.details, ['"vermoan"', '"opel"']);
  assert.deepEqual(s.calls, [["/Vermona MIDI", "/Opal Lead"]]);
  assert.equal(out.result.code, 0);
});

test("did you mean: an exact target next to a typo stays a target", async () => {
  const s = setup((c) => [c[0]!], allD);
  await runLine("mute /Kick, vermoan", s.deps);
  assert.deepEqual(s.picks[0]!.offered, ["/Vermona MIDI"]);
  assert.deepEqual([...s.calls[0]!].sort(), ["/Kick", "/Vermona MIDI"]);
});

test("did you mean: a hopeless text next to a fixable one fails at once, nothing asked", async () => {
  const s = setup((c) => c, allD);
  const out = await runLine("mute vermoan, zzzzzz", s.deps);
  assert.equal(s.picks.length, 0);
  assert.equal(out.result.code, ExitCode.NOT_FOUND);
});
