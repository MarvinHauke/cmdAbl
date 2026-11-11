import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withHelpLine } from "./helpLine.js";
import { createSettingsStore, SETTINGS_DEFAULTS, SETTINGS_FILE, createSettingsRegistry } from "../settings/settings.js";
import type { Ui } from "./ui.js";

function fakeUi() {
  const seen: Record<string, unknown> = {};
  const ui = {
    board: async (r: unknown) => ((seen.board = r), null),
    settings: async (r: unknown) => ((seen.settings = r), null),
    defaults: async (r: unknown) => ((seen.defaults = r), null),
    select: async (r: unknown) => ((seen.select = r), null),
    prompt: async (r: unknown) => ((seen.prompt = r), null),
    notify: () => {},
    notifyAnswer: async () => null,
  } as unknown as Ui;
  return { ui, seen };
}

const requests = (ui: Ui) =>
  Promise.all([
    ui.board({ title: "b", sections: [], apply: { label: "Apply" } } as never),
    ui.settings({ title: "s", groups: [] }),
    ui.defaults({ title: "d", rows: [] }, () => ({ ok: true })),
    ui.select({ title: "p", multi: false, items: [] }),
    ui.prompt({ items: [] }),
  ]);

test("ui.helpLine is declared on by default", async () => {
  assert.equal(SETTINGS_DEFAULTS["ui.helpLine"], true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-help-"));
  assert.equal((await createSettingsStore({ base: dir, warn: () => {} }).get())["ui.helpLine"], true);
  const def = createSettingsRegistry().def("ui.helpLine");
  assert.deepEqual({ kind: def?.kind, label: def?.label, help: def?.help, default: def?.default }, { kind: "bool", label: "Help line", help: "Show what the hovered or focused control does in the footer.", default: true });
});

test("help: every surface's request carries the value (on)", async () => {
  const { ui, seen } = fakeUi();
  await requests(withHelpLine(ui, async () => true));
  for (const k of ["board", "settings", "defaults", "select", "prompt"]) assert.equal((seen[k] as { help?: boolean }).help, true, k);
});

test("help: off is false in every request, from the stored setting", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-help-"));
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ "ui.helpLine": false }));
  const store = createSettingsStore({ base: dir, warn: () => {} });
  const { ui, seen } = fakeUi();
  await requests(withHelpLine(ui, async () => (await store.get())["ui.helpLine"]));
  for (const k of ["board", "settings", "defaults", "select", "prompt"]) assert.equal((seen[k] as { help?: boolean }).help, false, k);
});

test("help: a module cannot set it itself, and a failing read means on", async () => {
  const { ui, seen } = fakeUi();
  await withHelpLine(ui, async () => false).board({ title: "b", help: true, sections: [], apply: { label: "A" } } as never);
  assert.equal((seen.board as { help?: boolean }).help, false);
  await withHelpLine(ui, async () => { throw new Error("x"); }).select({ title: "p", multi: false, items: [] });
  assert.equal((seen.select as { help?: boolean }).help, true);
});
