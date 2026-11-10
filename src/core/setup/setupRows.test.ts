import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSetupRows, hasNewTrouble, karabinerImportUrl, setupLines, SCRIPT_COMMAND, type SetupFacts } from "./setupRows.js";
import type { StatusItem } from "../types.js";

const hello = (script: string) => ({ ok: true as const, value: { script, v: 1, ops: [] as string[] } });
const down = { ok: false as const, code: 5 as const, text: "Remote Script not running" };

function facts(over: { trigger?: Partial<SetupFacts["trigger"]>; script?: Partial<SetupFacts["script"]>; data?: boolean; platform?: NodeJS.Platform } = {}): SetupFacts {
  return {
    platform: over.platform ?? "darwin",
    trigger: { installed: true, ruleThere: true, enabled: true, ...over.trigger },
    script: { shipped: "0.1.15", installed: { status: "current", version: "0.1.15" }, running: hello("0.1.15"), copyNewerThanHost: false, copyFailed: null, ...over.script },
    dataFolderWritable: over.data ?? true,
    importUrl: karabinerImportUrl(27184),
    controlSurfaceUrl: "https://docs/x",
  };
}
const items = (f: SetupFacts): Array<{ id: string; status: string; item: StatusItem }> => {
  const built = buildSetupRows(f);
  const flat = built.sections.flatMap((s) => s.items as StatusItem[]);
  return built.rows.map((r, i) => ({ id: r.id, status: r.status, item: flat.find((x) => x === flat[i])! }));
};
const row = (f: SetupFacts, id: string) => items(f).find((r) => r.id === id);

test("all good: every row is ✓, no button, no signature", () => {
  const built = buildSetupRows(facts());
  assert.deepEqual(built.rows.map((r) => [r.id, r.status, r.signature]), [["karabiner", "ok", ""], ["script", "ok", ""], ["surface", "ok", ""], ["data", "ok", ""]]);
  for (const s of built.sections) for (const i of s.items as StatusItem[]) assert.equal(i.action, undefined);
});

test("Karabiner: not installed is yellow with Get Karabiner; no rule → Add rule with the import link; not enabled → yellow with Open Karabiner; never red", () => {
  const none = row(facts({ trigger: { installed: false, ruleThere: false, enabled: null } }), "karabiner")!;
  assert.equal(none.status, "warn");
  assert.match(none.item.text, /Strongly recommended/);
  assert.deepEqual(none.item.action && "url" in none.item.action && none.item.action.url, "https://karabiner-elements.pqrs.org/");
  const norule = row(facts({ trigger: { ruleThere: false, enabled: null } }), "karabiner")!;
  assert.equal(norule.status, "warn");
  assert.equal(norule.item.action?.label, "Add rule");
  assert.equal(norule.item.action && "url" in norule.item.action && norule.item.action.url, karabinerImportUrl(27184));
  const off = row(facts({ trigger: { enabled: false } }), "karabiner")!;
  assert.equal(off.status, "warn");
  assert.equal(off.item.action?.label, "Open Karabiner");
  assert.equal(off.item.action && "url" in off.item.action && off.item.action.url, "karabiner://karabiner/");
  const unknown = row(facts({ trigger: { enabled: null } }), "karabiner")!;
  assert.equal(unknown.status, "ok");
  assert.match(unknown.item.text, /enable it in Karabiner/);
});

test("the import link encodes the local rule address", () => {
  assert.equal(
    karabinerImportUrl(27184),
    "karabiner://karabiner/assets/complex_modifications/import?url=http%3A%2F%2F127.0.0.1%3A27184%2Fkarabiner%2Fcmdabl.json",
  );
});

test("Remote Script: missing → Copy; older → Update names both versions; copy failed → red; current → ✓", () => {
  const missing = row(facts({ script: { installed: { status: "missing" }, running: down } }), "script")!;
  assert.equal(missing.status, "warn");
  assert.deepEqual(missing.item.action, { label: "Copy", help: "Copy the Remote Script into Live's User Library.", command: SCRIPT_COMMAND });
  const old = row(facts({ script: { installed: { status: "outdated", version: "0.1.14" }, running: down } }), "script")!;
  assert.equal(old.status, "warn");
  assert.match(old.item.text, /Installed 0\.1\.14, this cmdAbl brings 0\.1\.15/);
  assert.equal(old.item.action?.label, "Update");
  const failed = row(facts({ script: { installed: { status: "missing" }, running: down, copyFailed: "permission denied" } }), "script")!;
  assert.equal(failed.status, "fail");
  assert.match(failed.item.text, /permission denied/);
});

test("Live restart vs control surface: the copy newer than the host start says restart; older and silent says choose it", () => {
  const restart = items(facts({ script: { installed: { status: "current", version: "0.1.15" }, running: down, copyNewerThanHost: true } }));
  assert.equal(restart.find((r) => r.id === "restart")?.status, "warn");
  assert.match(restart.find((r) => r.id === "restart")!.item.text, /Restart Live once/);
  assert.equal(restart.find((r) => r.id === "surface"), undefined);
  const choose = items(facts({ script: { running: down, copyNewerThanHost: false } }));
  assert.equal(choose.find((r) => r.id === "restart"), undefined);
  const surface = choose.find((r) => r.id === "surface")!;
  assert.equal(surface.status, "warn");
  assert.match(surface.item.text, /^Choose cmdAbl in Live's Settings/);
  assert.equal(surface.item.action?.label, "How");
  const unsure = row(facts({ script: { running: down, copyNewerThanHost: null } }), "surface")!;
  assert.match(unsure.item.text, /^Restart Live if you haven't/);
});

test("Live runs another version than the disk: restart row, no control surface row", () => {
  const rows = items(facts({ script: { running: hello("0.1.14") } }));
  assert.match(rows.find((r) => r.id === "restart")!.item.text, /Restart Live once to load Remote Script 0\.1\.15/);
  assert.equal(rows.find((r) => r.id === "surface"), undefined);
});

test("an unreadable folder (sandbox): the running script decides", () => {
  const same = row(facts({ script: { installed: { status: "unknown" }, running: hello("0.1.15"), copyNewerThanHost: null } }), "script")!;
  assert.equal(same.status, "ok");
  const older = row(facts({ script: { installed: { status: "unknown" }, running: hello("0.1.14"), copyNewerThanHost: null } }), "script")!;
  assert.equal(older.status, "warn");
  assert.equal(older.item.action?.label, "Update");
  const silent = row(facts({ script: { installed: { status: "unknown" }, running: down, copyNewerThanHost: null } }), "script")!;
  assert.equal(silent.status, "warn");
});

test("data folder: not writable is red without a button", () => {
  const r = row(facts({ data: false }), "data")!;
  assert.equal(r.status, "fail");
  assert.equal(r.item.action, undefined);
});

test("signatures: a ✓ has none; yellow rows carry the versions they are about; hasNewTrouble ignores rows already shown", () => {
  const a = buildSetupRows(facts({ script: { installed: { status: "outdated", version: "0.1.14" }, running: down } }));
  const sig = a.rows.find((r) => r.id === "script")!.signature;
  assert.equal(sig, "script:warn:0.1.14>0.1.15");
  assert.equal(hasNewTrouble(a.rows, [sig]), false);
  assert.equal(hasNewTrouble(a.rows, []), true);
  const b = buildSetupRows(facts({ script: { shipped: "0.1.16", installed: { status: "outdated", version: "0.1.14" }, running: down } }));
  assert.equal(hasNewTrouble(b.rows, [sig]), true); // a newer script is a new step
});

test("Windows: AutoHotkey rows; other platforms: no trigger row", () => {
  assert.equal(row(facts({ platform: "win32", trigger: { installed: true, ruleThere: false } }), "karabiner")!.item.action && "command" in row(facts({ platform: "win32", trigger: { installed: true, ruleThere: false } }), "karabiner")!.item.action!, true);
  assert.equal(row(facts({ platform: "linux" }), "karabiner"), undefined);
});

test("setupLines: marks, text and buttons as lines for a headless run", () => {
  const lines = setupLines(buildSetupRows(facts({ script: { installed: { status: "missing" }, running: down }, data: false })).sections);
  assert.match(lines, /^Keyboard trigger\n {2}✓ The : key opens cmdAbl\.$/m);
  assert.match(lines, /^ {2}! The Remote Script is not installed.* \[Copy: cmdabl setup script\]$/m);
  assert.match(lines, /^ {2}✗ cmdAbl can't write to its data folder/m);
});

test("the Keyboard trigger heading has the Karabiner website link on macOS in every state, and not on Windows", () => {
  for (const trigger of [{ installed: false, ruleThere: false, enabled: null }, { ruleThere: false, enabled: null }, { enabled: false }, { enabled: true }, { enabled: null }] as const) {
    const s = buildSetupRows(facts({ trigger: { ...trigger } })).sections.find((x) => x.heading === "Keyboard trigger")!;
    assert.deepEqual(s.link, { label: "Karabiner-Elements ↗", help: "Open the Karabiner-Elements website in your browser.", url: "https://karabiner-elements.pqrs.org/" });
  }
  const win = buildSetupRows(facts({ platform: "win32", trigger: { installed: true, ruleThere: true } })).sections.find((x) => x.heading === "Keyboard trigger")!;
  assert.equal(win.link, undefined);
});
