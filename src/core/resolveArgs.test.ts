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

// The own-name rule: a track E-Piano with a chain below it, a device named like its track.
const rootsE = [
  node("E-Piano", "track", [
    node("E-Piano", "device"),
    node("DefaultTracks", "device", [node("EQ Eight | Utility", "device"), node("Reverb", "device")]),
  ]),
  node("Opal Lead", "track", [node("Reverb", "device")]),
  node("Vermona MIDI", "track", [node("Drum Rack", "device", [node("Kick", "device")])]),
];
assignPaths(rootsE, "");
const allE = flattenObjectTree(rootsE);

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

test("joined words that hit ARE the reading: `sel vermona kick` resolves the pad, no list, no parents", async () => {
  const s = setup(() => null, allB);
  const out = await runLine("sel vermona kick", s.deps);
  assert.equal(out.result.code, 0);
  assert.equal(s.picks.length, 0);
  assert.deepEqual(s.calls, [["/Vermona MIDI/Drum Rack/Kick"]]);
  assert.equal(out.line, 'sel "/Vermona MIDI/Drum Rack/Kick"');
});

test("several joined hits: one list with exactly those, nothing from single words or parents", async () => {
  const s = setup((c) => c, allC);
  const out = await runLine("mute drums kick", s.deps); // /Drums/Kick and /Snare Drums/Kick 2 (the group "Drums" is not offered)
  assert.equal(s.picks.length, 1);
  assert.equal(s.picks[0]!.title, 'mute: "drums kick" matches 2');
  assert.deepEqual(s.picks[0]!.offered, ["/Drums/Kick", "/Snare Drums/Kick 2"]);
  assert.equal(out.result.code, 0);
});

test("the accepted consequence: group Drums with a track Kick — `drums kick` means Kick; a comma gives both", async () => {
  const roots = [node("Drums", "track", [node("Kick", "track")])];
  assignPaths(roots, "");
  const flat = flattenObjectTree(roots);
  const s = setup(() => null, flat);
  await runLine("mute drums kick", s.deps);
  assert.deepEqual(s.calls, [["/Drums/Kick"]]);
  const t = setup(() => null, flat);
  await runLine("mute drums, kick", t.deps);
  assert.deepEqual([...t.calls[0]!].sort(), ["/Drums", "/Drums/Kick"]);
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

test("own name: `sel e-piano` is exactly the track (a structural hit), not what sits below it", async () => {
  const s = setup(() => null, allE);
  const out = await runLine("sel e-piano", s.deps);
  assert.equal(out.result.code, 0);
  assert.deepEqual(s.calls, [["/E-Piano"]]);
  assert.equal(s.picks.length, 0);
});

test("own name: `sel piano` (not the whole name) finds objects whose OWN name contains it, not their children", async () => {
  const s = setup((c) => c, allE);
  await runLine("sel piano", s.deps);
  assert.deepEqual(s.picks[0]!.offered, ["/E-Piano", "/E-Piano/E-Piano"]); // not DefaultTracks/… below the track
});

test("own name: `sel e-piano utility` is the chain directly (the joined words hit once)", async () => {
  const s = setup(() => null, allE);
  const out = await runLine("sel e-piano utility", s.deps);
  assert.equal(out.result.code, 0);
  assert.equal(s.picks.length, 0);
  assert.deepEqual(s.calls, [["/E-Piano/DefaultTracks/EQ Eight | Utility"]]);
});

test("own name: `sel vermona kick` — parent word plus own-name word; the pad, no list", async () => {
  const s = setup(() => null, allE);
  await runLine("sel vermona kick", s.deps);
  assert.equal(s.picks.length, 0);
  assert.deepEqual(s.calls, [["/Vermona MIDI/Drum Rack/Kick"]]);
});

test("own name: a word that only occurs in a parent finds nothing (then suggestions or not found)", async () => {
  const s = setup((c) => c, allE);
  await runLine("sel vermona", s.deps); // own name Vermona MIDI only — not Drum Rack or Kick below it
  assert.deepEqual(s.calls, [["/Vermona MIDI"]]);
  const t = setup(() => null, allE);
  const out = await runLine("sel defaulttracks eq", t.deps); // parents only for the chain's children? "eq" is the own name
  assert.equal(out.result.code, 0);
  const u = setup(() => null, allE);
  const miss = await runLine("mute drum", u.deps); // mute: tracks only; "drum" names a device (not a track) and no track
  assert.equal(miss.result.code, ExitCode.NOT_FOUND);
});

test("own name: multi-word own names and a name shared by two devices", async () => {
  const s = setup(() => null, allE);
  await runLine('sel "opal lead"', s.deps);
  assert.deepEqual(s.calls, [["/Opal Lead"]]);
  const t = setup((c) => c, allE);
  await runLine("sel reverb", t.deps);
  assert.deepEqual(t.picks[0]!.offered, ["/E-Piano/DefaultTracks/Reverb", "/Opal Lead/Reverb"]);
});

test("ambiguous + missing: one list holds the real matches and the suggestions, each row tagged with its word", async () => {
  const s = setup((c) => c, allC);
  const out = await runLine("mute kick, snaer", s.deps); // "kick" hits two tracks; "snaer" matches nothing (typo of Snare)
  assert.equal(s.picks.length, 1);
  assert.equal(s.picks[0]!.title, 'mute: "kick" matches — nothing matches "snaer": did you mean');
  const offered = s.picks[0]!.offered;
  assert.ok(offered.includes("/Drums/Kick") && offered.includes("/Snare Drums/Kick 2") && offered.includes("/Drums/Snare"));
  assert.equal(s.picks[0]!.details![offered.indexOf("/Drums/Kick")], '"kick"');
  assert.equal(s.picks[0]!.details![offered.indexOf("/Drums/Snare")], '"snaer"?');
  assert.equal(out.result.code, 0); // all rows marked → they ran, no second list
  assert.deepEqual(s.calls[0]!.sort(), [...offered].sort());
});

test("ambiguous + missing: marking only some rows runs those; Esc ends with the not-found failure", async () => {
  const marked = setup((c) => c.filter((n) => n.path === "/Drums/Snare"), allC);
  const out = await runLine("mute kick, snaer", marked.deps);
  assert.equal(marked.picks.length, 1);
  assert.deepEqual(marked.calls, [["/Drums/Snare"]]);
  assert.equal(out.result.code, 0);
  const esc = setup(() => null, allC);
  const failed = await runLine("mute kick, snaer", esc.deps);
  assert.equal(failed.result.code, ExitCode.NOT_FOUND);
  assert.equal(failed.result.message, 'mute: nothing matches "snaer"');
  assert.deepEqual(esc.calls, []);
});

test("ambiguous + a text nothing fits: fails at once, no list", async () => {
  const s = setup((c) => c, allC);
  const out = await runLine("mute kick, zzzzzz", s.deps);
  assert.equal(out.result.code, ExitCode.NOT_FOUND);
  assert.equal(s.picks.length, 0);
});
