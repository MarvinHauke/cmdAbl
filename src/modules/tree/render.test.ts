import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { MAX_LINES, kindLabel, renderTree, rootsOf } from "./render.js";

let id = 0;
const make = (
  kind: ObjectNode["kind"],
  name: string,
  children: ObjectNode[] = [],
  scope: ObjectNode["scope"] = "regular",
): ObjectNode =>
  ({ handleId: String(++id), kind, scope, route: [id], name, path: `/${name}`, children }) as ObjectNode;
const flat = (roots: ObjectNode[]): ObjectNode[] => roots.flatMap((n) => [n, ...flat(n.children)]);

const kick = make("chain", "Kick");
const snare = make("chain", "Snare");
const rack = make("device", "Drum Rack", [kick, snare]);
const eq = make("device", "EQ");
const vermona = make("track", "Vermona MIDI", [rack, eq]);
const lead = make("track", "Lead");
const group = make("track", "Drums", [lead]);
const fx = make("track", "Fx", [], "return");
const main = make("track", "Main", [], "master");
const roots = [vermona, group, fx, main];
const nodes = flat(roots);

test("kindLabel names what a Live user knows", () => {
  assert.deepEqual(
    [vermona, group, fx, main, rack, eq, kick].map(kindLabel),
    ["track", "group track", "return track", "main track", "rack", "device", "chain"],
  );
});

test("rootsOf: the nodes that are nobody's child, in order", () => {
  assert.deepEqual(rootsOf(nodes).map((n) => n.name), ["Vermona MIDI", "Drums", "Fx", "Main"]);
});

test("the whole Set, default depth 2: tracks and their devices; counts of what is listed", () => {
  assert.equal(
    renderTree(nodes, { depth: 2 }),
    [
      "Live Set",
      "  Vermona MIDI  (track)",
      "    Drum Rack  (rack)",
      "    EQ  (device)",
      "  Drums  (group track)",
      "    Lead  (track)",
      "  Fx  (return track)",
      "  Main  (main track)",
      "5 tracks, 2 devices, 0 chains",
    ].join("\n"),
  );
});

test("depth 1 shows only the top level; a deeper depth reaches the chains", () => {
  assert.match(renderTree(nodes, { depth: 1 }), /^Live Set\n {2}Vermona MIDI {2}\(track\)\n {2}Drums/);
  assert.ok(!renderTree(nodes, { depth: 1 }).includes("Drum Rack"));
  const deep = renderTree(nodes, { depth: 3 });
  assert.ok(deep.includes("      Kick  (chain)"));
  assert.ok(deep.endsWith("5 tracks, 2 devices, 2 chains"));
});

test("starting at a node: its path as the header, levels counted below it", () => {
  assert.equal(
    renderTree(nodes, { start: vermona, depth: 2 }),
    [
      "/Vermona MIDI",
      "  Drum Rack  (rack)",
      "    Kick  (chain)",
      "    Snare  (chain)",
      "  EQ  (device)",
      "0 tracks, 2 devices, 2 chains",
    ].join("\n"),
  );
  assert.equal(renderTree(nodes, { start: kick, depth: 2 }), "/Kick\n  (nothing below)\n0 tracks, 0 devices, 0 chains");
});

test("an empty Set", () => {
  assert.equal(renderTree([], { depth: 2 }), "Live Set\n  (nothing below)\n0 tracks, 0 devices, 0 chains");
});

test("without chains (no Remote Script): a rack is a plain device and nothing below it", () => {
  const bare = make("device", "Drum Rack");
  const t = make("track", "T", [bare]);
  assert.match(renderTree(flat([t]), { depth: 3 }), /Drum Rack {2}\(device\)\n1 track, 1 device, 0 chains$/);
});

test("a long listing is cut with a hint", () => {
  const tracks = Array.from({ length: MAX_LINES + 50 }, (_, i) => make("track", `T${i}`));
  const text = renderTree(tracks, { depth: 1 });
  const lines = text.split("\n");
  assert.equal(lines.length, 1 + MAX_LINES + 1 + 1); // header, lines, hint, counts
  assert.match(lines[MAX_LINES + 1]!, /cut after 200 of 250 lines; pass a path or a smaller -L/);
  assert.ok(lines.at(-1)!.startsWith("200 tracks")); // only what is shown
});
