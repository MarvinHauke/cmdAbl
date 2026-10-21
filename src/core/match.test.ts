import { test } from "node:test";
import assert from "node:assert/strict";
import Fuse from "fuse.js";
import { filterRanked, filterer, matches, matchesNode, rank, ranker, suggest, valueHint } from "./match.js";

test("matches: every word occurs, any order, ignoring case", () => {
  assert.equal(matches("/Vermona MIDI/Drum Rack/Kick", "vermona kick"), true);
  assert.equal(matches("/Vermona MIDI/Drum Rack/Kick", "KICK  drum"), true);
  assert.equal(matches("/Vermona MIDI", "vermona snare"), false);
  assert.equal(matches("anything", "   "), false);
});

// The palette's order, pinned: rank is Fuse.js with the options and keys of the
// former ui/interface.html (threshold 0.4, ignoreLocation).
const ITEMS = [
  { id: "mute", title: "mute", subtitle: "mute tracks", keywords: "silence" },
  { id: "goto", title: "goto", subtitle: "select an object", keywords: "jump" },
  { id: "/Opal Lead", title: "Opal Lead", subtitle: "MIDI track", path: "/Opal Lead" },
  { id: "/Opal Lead/Reverb", title: "Reverb", subtitle: "device", path: "/Opal Lead/Reverb" },
  { id: "find", title: "find", subtitle: "search the Live Set", keywords: "grep" },
];
const KEYS = ["title", "subtitle", "keywords", "path"];

test("rank: the palette's former Fuse search, same order", () => {
  for (const query of ["mut", "opal", "lead rev", "sel", "grp", "fnd", "zzzz"]) {
    const direct = new Fuse(ITEMS, { threshold: 0.4, ignoreLocation: true, keys: KEYS }).search(query).map((r) => r.item.id);
    assert.deepEqual(rank(ITEMS, query, KEYS).map((i) => i.id), direct, query);
  }
  assert.deepEqual(rank(ITEMS, "mute", KEYS).map((i) => i.id)[0], "mute");
  assert.deepEqual(rank(ITEMS, "  ", KEYS), ITEMS);
});

test("filterRanked: filters by matches, orders by fuzzy rank, keeps the rest in order", () => {
  const labels = ["/Bass/Kick Layer", "/Drums/Kick", "/Kick", "/Pad"];
  const out = filterRanked(labels, "kick", (l) => l);
  assert.deepEqual([...out].sort(), ["/Bass/Kick Layer", "/Drums/Kick", "/Kick"]);
  // the order is Fuse's own, over the kept items
  const kept = labels.filter((l) => matches(l, "kick")).map((text) => ({ text }));
  const direct = new Fuse(kept, { threshold: 0.4, ignoreLocation: true, keys: ["text"] }).search("kick").map((r) => r.item.text);
  assert.deepEqual(out, direct);
  assert.deepEqual(filterRanked(labels, "", (l) => l), labels);
  // every word, any order — even when the fuzzy search would not score it
  assert.deepEqual(filterRanked(["/Drums/Kick"], "kick drums", (l) => l), ["/Drums/Kick"]);
  assert.deepEqual(filterRanked(labels, "nothing", (l) => l), []);
});

test("ranker and filterer: prepared once, same answers as the one-off forms", () => {
  const r = ranker(ITEMS, KEYS);
  const f = filterer(["/Bass/Kick Layer", "/Drums/Kick", "/Kick", "/Pad"], (l) => l);
  for (const query of ["mut", "opal", "", "grp"]) assert.deepEqual(r(query), rank(ITEMS, query, KEYS), query);
  for (const query of ["kick", "", "kick drums", "pad"]) {
    assert.deepEqual(f(query), filterRanked(["/Bass/Kick Layer", "/Drums/Kick", "/Kick", "/Pad"], query, (l) => l), query);
  }
});

test("suggest: every word fits fuzzily; short words and no fit give nothing; capped", () => {
  const paths = [{ path: "/Vermona MIDI" }, { path: "/Opal Lead" }, { path: "/Kick" }];
  assert.deepEqual(suggest(paths, "vermoan", ["path"]).map((p) => p.path), ["/Vermona MIDI"]);
  assert.deepEqual(suggest(paths, "vm", ["path"]), []);
  assert.deepEqual(suggest(paths, "zzzzzz", ["path"]), []);
  assert.deepEqual(suggest(paths, "", ["path"]), []);
  const many = Array.from({ length: 20 }, (_, i) => ({ path: `/Track ${i}` }));
  assert.ok(suggest(many, "trak", ["path"]).length <= 8);
});

test("matchesNode: every word in the path, at least one in the object's own name", () => {
  const track = { path: "/E-Piano", name: "E-Piano" };
  const chain = { path: "/E-Piano/DefaultTracks/EQ Eight | Utility", name: "EQ Eight | Utility" };
  assert.equal(matchesNode(track, "e-piano"), true);
  assert.equal(matchesNode(chain, "e-piano"), false); // only the parent is named
  assert.equal(matchesNode(chain, "e-piano utility"), true);
  assert.equal(matchesNode(chain, "utility"), true);
  assert.equal(matchesNode(chain, "zzz"), false);
  assert.equal(matchesNode({ path: "/Drums/Kick#2", name: "Kick" }, "kick#2"), true); // a typed ordinal
  assert.equal(matchesNode({ path: "/Vermona MIDI/Kick", name: "Kick" }, "midi/kick"), true); // path fragment: last part names the object
});

test("suggest with an own-name field: a close parent name alone does not suggest what sits below it", () => {
  const items = [
    { path: "/Vermona MIDI", name: "Vermona MIDI" },
    { path: "/Vermona MIDI/Kick", name: "Kick" },
  ];
  assert.deepEqual(suggest(items, "vermoan", ["path"], 8, "name").map((i) => i.path), ["/Vermona MIDI"]);
  assert.equal(suggest(items, "vermoan", ["path"]).length, 2); // without the own-name field both come
});

test("valueHint: the label of the next value after a value option", () => {
  const specs = [
    { path: [], name: "rename", short: "r", labels: ["old", "new"] },
    { path: [], name: "edit", short: "e", labels: ["tag|#"] },
    { path: ["go"], name: "n", labels: ["n"] },
  ];
  assert.equal(valueHint(specs, "--rename "), "<old>");
  assert.equal(valueHint(specs, "-r fx "), "<new>");
  assert.equal(valueHint(specs, "--rename=fx "), "<new>");
  assert.equal(valueHint(specs, "--rename fx effects "), null);
  assert.equal(valueHint(specs, "-e "), "<tag|#>");
  assert.equal(valueHint(specs, "-e fx /bass "), null);
  assert.equal(valueHint(specs, "--rename"), null); // no trailing space: still typing the name
  assert.equal(valueHint(specs, "--rename fx"), null); // still typing the value
  assert.equal(valueHint(specs, '--rename "a b" '), "<new>");
  assert.equal(valueHint(specs, "/bass "), null);
  assert.equal(valueHint(specs, "go -- "), null);
  assert.equal(valueHint(specs, "go --n "), "<n>");
  assert.equal(valueHint(specs, "--n "), null); // belongs to the subcommand
  assert.equal(valueHint(specs, '-r "my '), null); // inside an open quote
  assert.equal(valueHint(specs, "-- --rename "), null); // after -- it is text
  assert.equal(valueHint(undefined, "--rename "), null);
});
