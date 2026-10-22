import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSettingsStore, parsePaletteAnswer, parsePaletteSettings, takePaletteAnswer, SETTINGS_DEFAULTS, SETTINGS_FILE, toPaletteSettings } from "./settings.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-settings-"));

test("a missing file gives the defaults, quietly", async () => {
  const warnings: string[] = [];
  const store = createSettingsStore({ base: path.join(tmp(), "none"), warn: (t) => warnings.push(t) });
  assert.deepEqual(await store.get(), { "palette.optionsAbove": false });
  assert.deepEqual(toPaletteSettings(await store.get()), { optionsAbove: false });
  assert.deepEqual(warnings, []);
  assert.equal(SETTINGS_DEFAULTS["palette.optionsAbove"], false);
});

test("a broken file, a non-object and a wrong type give the defaults and one warning each; nothing throws", async () => {
  for (const [text, expected] of [
    ["{ not json", /not a JSON object/],
    ["[1,2]", /not a JSON object/],
    ["null", /not a JSON object/],
    ['{"palette.optionsAbove": "yes"}', /"palette.optionsAbove" has the wrong type/],
  ] as const) {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), text);
    const warnings: string[] = [];
    const store = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
    assert.deepEqual(await store.get(), { "palette.optionsAbove": false }, text);
    assert.equal(warnings.length, 1, text);
    assert.match(warnings[0]!, expected);
    await store.get(); // read once: no second warning
    assert.equal(warnings.length, 1);
  }
  // a file that cannot be read at all (a folder where the file should be)
  const dir = tmp();
  fs.mkdirSync(path.join(dir, SETTINGS_FILE));
  const warnings: string[] = [];
  assert.deepEqual(await createSettingsStore({ base: dir, warn: (t) => warnings.push(t) }).get(), { "palette.optionsAbove": false });
  assert.match(warnings[0]!, /cannot read settings.json/);
});

test("the round trip: set, a new store reads it, other keys are kept, no temporary file stays", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ "future.key": [1], "palette.optionsAbove": false }));
  const warnings: string[] = [];
  const store = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
  assert.equal(await store.set({ "palette.optionsAbove": true }), true);
  assert.deepEqual(await store.get(), { "palette.optionsAbove": true }); // in effect at once
  const again = createSettingsStore({ base: dir, warn: (t) => warnings.push(t) });
  assert.deepEqual(await again.get(), { "palette.optionsAbove": true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8")), { "future.key": [1], "palette.optionsAbove": true });
  assert.deepEqual(fs.readdirSync(dir), [SETTINGS_FILE]);
  assert.deepEqual(warnings, []);
  // a patch with a wrong type or an unknown key changes nothing
  await again.set({ "palette.optionsAbove": "no", nope: 1 } as never);
  assert.deepEqual(await again.get(), { "palette.optionsAbove": true });
});

test("a patch that changes nothing writes nothing", async () => {
  const dir = tmp();
  const store = createSettingsStore({ base: dir, warn: () => {} });
  assert.equal(await store.set({ "palette.optionsAbove": false }), true);
  assert.deepEqual(fs.readdirSync(dir), []); // still the defaults: no file yet
  await store.set({ "palette.optionsAbove": true });
  const stamp = fs.statSync(path.join(dir, SETTINGS_FILE)).mtimeMs;
  await new Promise((r) => setTimeout(r, 15));
  await store.set({ "palette.optionsAbove": true });
  assert.equal(fs.statSync(path.join(dir, SETTINGS_FILE)).mtimeMs, stamp);
});

test("creates the folder on the first write; a failing disk answers false with a warning and keeps the value in effect", async () => {
  const base = path.join(tmp(), "a", "b");
  const store = createSettingsStore({ base, warn: () => {} });
  assert.equal(await store.set({ "palette.optionsAbove": true }), true);
  assert.ok(fs.existsSync(path.join(base, SETTINGS_FILE)));
  const warnings: string[] = [];
  const dir = tmp();
  const blocked = createSettingsStore({
    base: dir,
    warn: (t) => warnings.push(t),
    fs: { readFile: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })), mkdir: async () => Promise.reject(Object.assign(new Error("x"), { code: "EACCES" })) as never, writeFile: async () => {}, rename: async () => {}, unlink: async () => {} },
  });
  assert.equal(await blocked.set({ "palette.optionsAbove": true }), false);
  assert.match(warnings.join("\n"), /cannot write settings.json \(EACCES\)/);
  assert.deepEqual(await blocked.get(), { "palette.optionsAbove": true });
});

test("two quick changes are written one after the other; the last one wins", async () => {
  const dir = tmp();
  const store = createSettingsStore({ base: dir, warn: () => {} });
  const a = store.set({ "palette.optionsAbove": true });
  const b = store.set({ "palette.optionsAbove": false });
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8")), { "palette.optionsAbove": false });
});

test("parsePaletteSettings and parsePaletteAnswer: result, settings, both, or neither", () => {
  assert.deepEqual(parsePaletteSettings({ optionsAbove: true, extra: 1 }), { optionsAbove: true });
  assert.equal(parsePaletteSettings({ optionsAbove: "yes" }), null);
  assert.equal(parsePaletteSettings(null), null);
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ type: "command", id: "mute", line: "mute a" })), { result: { type: "command", id: "mute", line: "mute a" }, settings: null });
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ type: "command", id: "mute", settings: { optionsAbove: true } })), {
    result: { type: "command", id: "mute" },
    settings: { optionsAbove: true },
  });
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ settings: { optionsAbove: true } })), { result: null, settings: { optionsAbove: true } });
  assert.deepEqual(parsePaletteAnswer(JSON.stringify({ settings: { optionsAbove: 1 } })), { result: null, settings: null });
  for (const raw of [null, "", "nope", "[]", "5", '{"type":3}']) assert.deepEqual(parsePaletteAnswer(raw), { result: null, settings: null }, String(raw));
});

// The palette surface hands the page's one answer string to takePaletteAnswer.
const take = (raw: string | null, saved: Array<{ optionsAbove: boolean }>, bad: string[] = []) =>
  takePaletteAnswer(raw, (s) => void saved.push(s), (r) => void bad.push(r));

test("a settings-only palette answer saves the settings and runs nothing (null result)", () => {
  const saved: Array<{ optionsAbove: boolean }> = [];
  assert.equal(take(JSON.stringify({ settings: { optionsAbove: true } }), saved), null);
  assert.deepEqual(saved, [{ optionsAbove: true }]);
});

test("a normal result with settings saves them and runs as usual; one without settings saves nothing", () => {
  const saved: Array<{ optionsAbove: boolean }> = [];
  assert.deepEqual(take(JSON.stringify({ type: "command", id: "mute", line: "mute a", settings: { optionsAbove: false } }), saved), { type: "command", id: "mute", line: "mute a" });
  assert.deepEqual(saved, [{ optionsAbove: false }]);
  assert.deepEqual(take(JSON.stringify({ type: "command", id: "mute", line: "mute a" }), saved), { type: "command", id: "mute", line: "mute a" });
  assert.equal(take(null, saved), null);
  assert.equal(saved.length, 1);
});

test("an unreadable answer is logged and runs nothing; a throwing saver never fails the run", () => {
  const bad: string[] = [];
  assert.equal(take("nope", [], bad), null);
  assert.equal(take('{"type":3}', [], bad), null);
  assert.equal(bad.length, 2);
  const out = takePaletteAnswer(
    JSON.stringify({ type: "command", id: "x", settings: { optionsAbove: true } }),
    () => {
      throw new Error("disk");
    },
    () => {},
  );
  assert.deepEqual(out, { type: "command", id: "x" });
});
