import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { findNodes } from "./select.js";

let id = 0;
const make = (kind: ObjectNode["kind"], name: string, parentPath: string, children: ObjectNode[] = []): ObjectNode =>
  ({ handleId: String(++id), kind, scope: "regular", route: [id], name, path: `${parentPath}/${name}`, children }) as ObjectNode;
const flat = (roots: ObjectNode[]): ObjectNode[] => roots.flatMap((n) => [n, ...flat(n.children)]);

// /Vermona MIDI ── Drum Rack ── Kick, Snare
// /Kick Bus ── EQ
const kick = make("chain", "Kick", "/Vermona MIDI/Drum Rack");
const snare = make("chain", "Snare", "/Vermona MIDI/Drum Rack");
const rack = make("device", "Drum Rack", "/Vermona MIDI", [kick, snare]);
const vermona = make("track", "Vermona MIDI", "", [rack]);
const eq = make("device", "EQ", "/Kick Bus");
const bus = make("track", "Kick Bus", "", [eq]);
const nodes = flat([vermona, bus]);
const ALL = ["track", "device", "chain"] as const;
const names = (ns: ObjectNode[]) => ns.map((n) => n.name);
const q = (pattern: string | undefined, level: number | undefined, kinds: Array<(typeof ALL)[number]> = [...ALL]) =>
  names(findNodes(nodes, { pattern, level, kinds }));

test("no level: a search — everything whose path contains the words", () => {
  assert.deepEqual(q("vermona", undefined), ["Vermona MIDI", "Drum Rack", "Kick", "Snare"]);
  assert.deepEqual(q("kick", undefined), ["Kick", "Kick Bus", "EQ"].sort((a, b) => names(nodes).indexOf(a) - names(nodes).indexOf(b)));
});

test("-L 0: only objects whose own name contains the words (the own-name rule)", () => {
  assert.deepEqual(q("vermona", 0), ["Vermona MIDI"]);
  assert.deepEqual(q("kick", 0), ["Kick", "Kick Bus"]);
  assert.deepEqual(q("vermona kick", 0), ["Kick"]); // all words in the path, one in the own name
});

test("-L n adds the children, grandchildren, … of those objects", () => {
  assert.deepEqual(q("vermona", 1), ["Vermona MIDI", "Drum Rack"]);
  assert.deepEqual(q("vermona", 2), ["Vermona MIDI", "Drum Rack", "Kick", "Snare"]);
  assert.deepEqual(q("kick", 1), ["Kick", "Kick Bus", "EQ"].sort((a, b) => names(nodes).indexOf(a) - names(nodes).indexOf(b)));
});

test("kind flags narrow the results, never the anchors", () => {
  assert.deepEqual(q("vermona", 1, ["chain"]), []); // the chains are two levels below
  assert.deepEqual(q("vermona", 2, ["chain"]), ["Kick", "Snare"]);
  assert.deepEqual(q("kick", 0, ["track"]), ["Kick Bus"]);
});

test("no pattern: from the top of the Set; -L n = levels below it", () => {
  assert.deepEqual(q(undefined, undefined, ["track"]), ["Vermona MIDI", "Kick Bus"]);
  assert.deepEqual(q(undefined, 1), ["Vermona MIDI", "Kick Bus"]);
  assert.deepEqual(q(undefined, 2), ["Vermona MIDI", "Drum Rack", "Kick Bus", "EQ"]);
  assert.deepEqual(q(undefined, 2, ["chain"]), []);
  assert.deepEqual(q(undefined, 3, ["chain"]), ["Kick", "Snare"]);
  assert.deepEqual(q("  ", undefined, ["chain"]), ["Kick", "Snare"]); // blank = no pattern
});
