import { test } from "node:test";
import assert from "node:assert/strict";
import { assignPaths, flattenObjectTree, type ObjectNode } from "./objectTree.js";
import { resolvePath } from "./resolvePath.js";

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

// Drums ─ Kick, Kick, Snare(+EQ Eight)    Kick    Opal Lead(+EQ Eight)
const roots = [
  node("Drums", "track", [node("Kick", "track"), node("Kick", "track"), node("Snare", "track", [node("EQ Eight", "device")])]),
  node("Kick", "track"),
  node("Opal Lead", "track", [node("EQ Eight", "device")]),
];
assignPaths(roots, "");
const all = flattenObjectTree(roots);
const paths = (query: string, kinds?: ("track" | "device")[]) => resolvePath(all, query, kinds).map((n) => n.path);

test("assignPaths: duplicate siblings get an ordinal suffix", () => {
  assert.deepEqual(all.map((n) => n.path), [
    "/Drums",
    "/Drums/Kick",
    "/Drums/Kick#2",
    "/Drums/Snare",
    "/Drums/Snare/EQ Eight",
    "/Kick",
    "/Opal Lead",
    "/Opal Lead/EQ Eight",
  ]);
});

test("resolvePath: a name shared by siblings is ambiguous, ordinals pick one", () => {
  assert.deepEqual(paths("/Drums/Kick"), ["/Drums/Kick", "/Drums/Kick#2"]);
  assert.deepEqual(paths("/Drums/Kick#2"), ["/Drums/Kick#2"]);
  assert.deepEqual(paths("/Drums/Kick#1"), ["/Drums/Kick"]);
});

test("resolvePath: exact path is not confused with deeper same-named objects", () => {
  assert.deepEqual(paths("/Kick"), ["/Kick"]);
  assert.deepEqual(paths("Kick"), ["/Kick"]); // leading slash optional
});

test("resolvePath: case-insensitive, then substring", () => {
  assert.deepEqual(paths("/drums/snare"), ["/Drums/Snare"]);
  assert.deepEqual(paths("snar"), ["/Drums/Snare", "/Drums/Snare/EQ Eight"]);
  assert.deepEqual(paths("snar", ["track"]), ["/Drums/Snare"]);
  assert.deepEqual(paths("opal"), ["/Opal Lead", "/Opal Lead/EQ Eight"]);
});

test("resolvePath: nothing matches", () => {
  assert.deepEqual(paths("/nope"), []);
  assert.deepEqual(paths("  "), []);
  assert.deepEqual(paths("/Drums/Kick#3"), []);
});
