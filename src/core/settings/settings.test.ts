import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSettingsStore, parsePaletteAnswer, takePaletteAnswer, SETTINGS_DEFAULTS, SETTINGS_FILE } from "./settings.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-settings-"));

test("a missing file gives the defaults, quietly", async () => {
  const warnings: string[] = [];
  const store = createSettingsStore({ base: path.join(tmp(), "none"), warn: (t) => warnings.push(t) });
  assert.deepEqual(await store.get(), { "map.enabled": true, "midi.statusBar": false, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false });
  assert.deepEqual(warnings, []);
  assert.equal("palette.above" in SETTINGS_DEFAULTS, false);
});

test("a broken file, a non-object and a wrong type give the defaults and one warning each; nothing throws", async () => {
  for (const [text, expected] of [
    ["{ not json", /not a JSON object/],
    ["[1,2]", /not a JSON object/],
    ["null", /not a JSON object/],
    ['{"map.enabled": "yes"}', /"map.enabled" has a wrong value/],
  ] as const) {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), text);
    const warnings: string[] = [];
    const store = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
    assert.deepEqual(await store.get(), { "map.enabled": true, "midi.statusBar": false, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false }, text);
    assert.equal(warnings.length, 1, text);
    assert.match(warnings[0]!, expected);
    await store.get(); // read once: no second warning
    assert.equal(warnings.length, 1);
  }
  // a file that cannot be read at all (a folder where the file should be)
  const dir = tmp();
  fs.mkdirSync(path.join(dir, SETTINGS_FILE));
  const warnings: string[] = [];
  assert.deepEqual(await createSettingsStore({ base: dir, warn: (t) => warnings.push(t) }).get(), { "map.enabled": true, "midi.statusBar": false, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false });
  assert.match(warnings[0]!, /cannot read settings.json/);
});

test("the round trip: set, a new store reads it, other keys are kept, no temporary file stays", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ "future.key": [1], "palette.above": "hints" }));
  const warnings: string[] = [];
  const store = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
  assert.equal(await store.set({ "midi.statusBar": true }), true);
  assert.deepEqual(await store.get(), { "map.enabled": true, "midi.statusBar": true, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false }); // in effect at once
  const again = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
  assert.deepEqual(await again.get(), { "map.enabled": true, "midi.statusBar": true, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8")), { "future.key": [1], "palette.above": "hints", "map.enabled": true, "midi.statusBar": true, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false });
  assert.deepEqual(fs.readdirSync(dir), [SETTINGS_FILE]);
  assert.deepEqual(warnings, []);
  // a patch with a wrong type or an unknown key changes nothing
  await again.set({ "midi.statusBar": "no", nope: 1 } as never);
  assert.deepEqual(await again.get(), { "map.enabled": true, "midi.statusBar": true, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false });
});

test("a patch that changes nothing writes nothing", async () => {
  const dir = tmp();
  const store = createSettingsStore({ base: dir, warn: () => {} });
  assert.equal(await store.set({ "midi.statusBar": false }), true);
  assert.deepEqual(fs.readdirSync(dir), []); // still the defaults: no file yet
  await store.set({ "midi.statusBar": true });
  const stamp = fs.statSync(path.join(dir, SETTINGS_FILE)).mtimeMs;
  await new Promise((r) => setTimeout(r, 15));
  await store.set({ "midi.statusBar": true });
  assert.equal(fs.statSync(path.join(dir, SETTINGS_FILE)).mtimeMs, stamp);
});

test("creates the folder on the first write; a failing disk answers false with a warning and keeps the value in effect", async () => {
  const base = path.join(tmp(), "a", "b");
  const store = createSettingsStore({ base, warn: () => {} });
  assert.equal(await store.set({ "midi.statusBar": true }), true);
  assert.ok(fs.existsSync(path.join(base, SETTINGS_FILE)));
  const warnings: string[] = [];
  const dir = tmp();
  const blocked = createSettingsStore({
    base: dir,
    warn: (t) => warnings.push(t),
    fs: { readFile: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })), mkdir: async () => Promise.reject(Object.assign(new Error("x"), { code: "EACCES" })) as never, writeFile: async () => {}, rename: async () => {}, unlink: async () => {}, stat: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })) },
  });
  assert.equal(await blocked.set({ "midi.statusBar": true }), false);
  assert.match(warnings.join("\n"), /cannot write settings.json \(EACCES\)/);
  assert.deepEqual(await blocked.get(), { "map.enabled": true, "midi.statusBar": true, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false });
});

test("an old palette.above value in settings.json is ignored without a warning and kept in the file", async () => {
  for (const value of ['"hints"', '"options"', '"off"', '"both"', "1", "null"]) {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), `{"palette.above": ${value}}`);
    const warnings: string[] = [];
    const store = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
    assert.deepEqual(await store.get(), { "map.enabled": true, "midi.statusBar": false, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false }, value);
    assert.equal("palette.above" in (await store.get()), false);
    assert.deepEqual(warnings, [], value);
  }
});

test("an edit of the file from outside is picked up at the next get; our own writes are not reloaded", async () => {
  const dir = tmp();
  const file = path.join(dir, SETTINGS_FILE);
  const warnings: string[] = [];
  const store = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
  assert.equal((await store.get())["midi.statusBar"], false);
  fs.writeFileSync(file, JSON.stringify({ "midi.statusBar": true })); // by hand, after the first read
  assert.equal((await store.get())["midi.statusBar"], true);
  fs.writeFileSync(file, JSON.stringify({ "midi.statusBar": false, "x": 1 }));
  assert.equal((await store.get())["midi.statusBar"], false);
  // a write of our own: in effect at once, and the written file is not read back as "changed"
  await store.set({ "midi.statusBar": true });
  assert.equal((await store.get())["midi.statusBar"], true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { x: 1, "map.enabled": true, "midi.statusBar": true, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false }); // the outside key survived
  // the file removed: back to the defaults, quietly; a broken edit: defaults and ONE warning
  fs.unlinkSync(file);
  assert.equal((await store.get())["midi.statusBar"], false);
  fs.writeFileSync(file, "{ nope");
  await store.get();
  await store.get();
  await store.get();
  assert.equal(warnings.length, 1);
  // a quick set followed by get never loses the pending value
  const racing = createSettingsStore({ base: tmp(), warn: () => {} });
  void racing.set({ "midi.statusBar": true });
  assert.equal((await racing.get())["midi.statusBar"], true);
});

test("two quick changes are written one after the other; the last one wins", async () => {
  const dir = tmp();
  const store = createSettingsStore({ base: dir, warn: () => {} });
  const a = store.set({ "midi.statusBar": true });
  const b = store.set({ "midi.statusBar": false });
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8")), { "map.enabled": true, "midi.statusBar": false, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false });
});

test("parsePaletteAnswer: the result to run, or nothing; an old `settings` field is dropped", () => {
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ type: "command", id: "mute", line: "mute a" })), { result: { type: "command", id: "mute", line: "mute a" } });
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ type: "command", id: "mute", settings: { above: "hints" } })), { result: { type: "command", id: "mute" } });
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ settings: { above: "hints" } })), { result: null });
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ settings: true, text: "mu" })), { result: null });
  for (const raw of [null, "", "nope", "[]", "5", '{"type":3}']) assert.deepEqual(parsePaletteAnswer(raw), { result: null }, String(raw));
});

test("takePaletteAnswer returns the result; an unreadable answer is logged and runs nothing, an empty one is silent", () => {
  const bad: string[] = [];
  const take = (raw: string | null) => takePaletteAnswer(raw, (r) => void bad.push(r));
  assert.deepEqual(take(JSON.stringify({ type: "command", id: "mute", line: "mute a" })), { type: "command", id: "mute", line: "mute a" });
  assert.deepEqual(take(JSON.stringify({ type: "command", id: "x", settings: { above: "hints" } })), { type: "command", id: "x" });
  assert.equal(take(null), null);
  assert.equal(take(""), null);
  assert.deepEqual(bad, []);
  assert.equal(take("nope"), null);
  assert.equal(take('{"type":3}'), null);
  assert.equal(bad.length, 2);
});

test("map.enabled defaults to true, can be switched off and is read back; a non-boolean is the default plus a warning", async () => {
  const dir = tmp();
  const store = createSettingsStore({ base: dir, warn: () => {} });
  assert.equal((await store.get())["map.enabled"], true);
  await store.set({ "map.enabled": false });
  assert.equal((await createSettingsStore({ base: dir, warn: () => {} }).get())["map.enabled"], false);
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), '{"map.enabled": "no"}');
  const warnings: string[] = [];
  assert.equal((await createSettingsStore({ base: dir, warn: (t) => warnings.push(t) }).get())["map.enabled"], true);
  assert.equal(warnings.length, 1);
});

test("midi.statusBar defaults to false, round-trips, and a non-boolean is the default plus a warning", async () => {
  const dir = tmp();
  const store = createSettingsStore({ base: dir, warn: () => {} });
  assert.equal((await store.get())["midi.statusBar"], false);
  await store.set({ "midi.statusBar": true });
  assert.equal((await createSettingsStore({ base: dir, warn: () => {} }).get())["midi.statusBar"], true);
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), '{"midi.statusBar": 1}');
  const warnings: string[] = [];
  assert.equal((await createSettingsStore({ base: dir, warn: (t) => warnings.push(t) }).get())["midi.statusBar"], false);
  assert.equal(warnings.length, 1);
});

// ── declared settings (plan 0019 §1) ────────────────────────────────────────────

import { createSettingsRegistry, CORE_GROUPS, fits, problemWith, type SettingDef } from "./settings.js";

const fold: SettingDef = { key: "tag.foldAfter", label: "Fold after", help: "Tags with more tracks start folded.", kind: "int", default: 20, min: 1, max: 500 };

test("core declares exactly its keys (no palette.above): ui.helpLine, setup.*, map.enabled, midi.statusBar", () => {
  const registry = createSettingsRegistry();
  assert.deepEqual(registry.keys(), ["ui.helpLine", "setup.openOnStart", "setup.autoScript", "map.enabled", "midi.statusBar"]);
  assert.deepEqual(CORE_GROUPS.map((g) => g.id), ["cmdabl", "setup", "map", "midi"]);
  for (const key of Object.keys(SETTINGS_DEFAULTS)) assert.equal(registry.def(key)!.default, (SETTINGS_DEFAULTS as Record<string, unknown>)[key]);
});

test("a module declares its group: keys need its prefix; bad items are dropped with a warning, the rest stays", () => {
  const warnings: string[] = [];
  const registry = createSettingsRegistry((t) => warnings.push(t));
  const problems = registry.declare("tag", {
    heading: "Tags",
    items: [
      fold,
      { ...fold, key: "other.foldAfter" }, // outside the namespace
      { ...fold, key: "tag.bad", default: 0 }, // default outside min…max
      { ...fold, key: "tag.nan", default: 1.5 }, // not a whole number
      { key: "tag.e", label: "E", help: "h", kind: "enum", default: "z", choices: [{ value: "a", label: "A" }] }, // default not a choice
      { key: "tag.dup", label: "D", help: "h", kind: "bool", default: true },
      { key: "tag.dup", label: "D", help: "h", kind: "bool", default: true }, // twice
      { key: "tag.nolabel", label: "", help: "h", kind: "bool", default: true },
      { key: "tag.kind", label: "K", help: "h", kind: "float", default: 1 } as never,
      { key: "ui.helpLine", label: "steal", help: "h", kind: "bool", default: true }, // outside, and declared by core
    ],
  });
  assert.equal(problems.length, warnings.length);
  assert.equal(problems.length, 8);
  assert.deepEqual(registry.groups().find((g) => g.id === "tag")!.items.map((i) => i.key), ["tag.foldAfter", "tag.dup"]);
  assert.match(warnings.join("\n"), /outside the namespace "tag\."/);
  assert.match(warnings.join("\n"), /"tag.dup" is declared already/);
  // a group of only bad items is not created; a bad id or heading drops the group
  assert.equal(registry.declare("nothing", { heading: "N", items: [{ ...fold, key: "x.y" }] }).length, 1);
  assert.equal(registry.groups().some((g) => g.id === "nothing"), false);
  assert.equal(registry.declare("Bad Id", { heading: "N", items: [] }).length, 1);
  assert.equal(registry.declare("ok", { heading: "", items: [] }).length, 1);
  assert.equal(registry.declare("ok", null as never).length, 1);
});

test("a module cannot take over core's group id; groups are core first, then modules by name", () => {
  const registry = createSettingsRegistry();
  assert.equal(registry.declare("map", { heading: "Mine", items: [{ key: "map.other", label: "O", help: "h", kind: "bool", default: true }] }).length, 1);
  registry.declare("tag", { heading: "Tags", items: [fold] });
  registry.declare("note", { heading: "Notes", items: [{ key: "note.editLoop", label: "L", help: "h", kind: "bool", default: false }] });
  assert.deepEqual(registry.groups().map((g) => g.id), ["cmdabl", "setup", "map", "midi", "note", "tag"]);
});

test("fits and problemWith follow the declaration", () => {
  assert.equal(fits(fold, 20), true);
  for (const bad of [0, 501, 2.5, "3", null, NaN]) assert.equal(fits(fold, bad), false, String(bad));
  assert.equal(problemWith(fold, "tag"), null);
  assert.match(problemWith({ ...fold, min: 10, max: 5 }, "tag")!, /min and max/);
  assert.match(problemWith(null, "tag")!, /not an object/);
  assert.match(problemWith({ ...fold, label: "x".repeat(301) }, "tag")!, /label/);
});

test("a declared int key: read from the file, wrong values give the default and one warning, set validates range, unknown keys survive", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ "tag.foldAfter": 3, "future.key": [1] }));
  const warnings: string[] = [];
  const registry = createSettingsRegistry();
  registry.declare("tag", { heading: "Tags", items: [fold] });
  const store = createSettingsStore({ base: dir, registry, warn: (t) => warnings.push(t) });
  assert.equal((await store.get())["tag.foldAfter"], 3);
  assert.equal(await store.set({ "tag.foldAfter": 0 }), true); // out of range: ignored
  assert.equal((await store.get())["tag.foldAfter"], 3);
  await store.set({ "tag.foldAfter": 9 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8")), { "future.key": [1], "map.enabled": true, "midi.statusBar": false, "ui.helpLine": true, "setup.openOnStart": true, "setup.autoScript": false, "tag.foldAfter": 9 });
  // a hand edit to a wrong value
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ "tag.foldAfter": 999 }));
  assert.equal((await store.get())["tag.foldAfter"], 20);
  await store.get();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /"tag.foldAfter" has a wrong value/);
});

test("a key declared after the file was read picks up its stored value (no restart, no reload)", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ "tag.foldAfter": 7 }));
  const registry = createSettingsRegistry();
  const store = createSettingsStore({ base: dir, registry, warn: () => {} });
  assert.equal((await store.get())["tag.foldAfter"], undefined); // nobody declared it yet
  registry.declare("tag", { heading: "Tags", items: [fold] });
  assert.equal((await store.get())["tag.foldAfter"], 7);
});
