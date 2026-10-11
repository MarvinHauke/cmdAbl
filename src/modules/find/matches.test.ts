import { test } from "node:test";
import assert from "node:assert/strict";
import { MatchList, matchesPattern } from "./matches.js";

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
