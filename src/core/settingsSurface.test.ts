import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSettingsRequest, capSettings, createSettingsFlow, isGearAnswer, parseSettingsAnswer, settingsSize, MAX_GROUPS, MAX_ROWS } from "./settingsSurface.js";
import { createSettingsRegistry, createSettingsStore, SETTINGS_FILE, type SettingDef } from "./settings.js";
import type { SettingsAnswer, SettingsRequest } from "./ui.js";
import { ExitCode } from "./types.js";
import fixture from "./settingsRequest.fixture.json" with { type: "json" };

const foldAfter: SettingDef = { key: "tag.foldAfter", label: "Fold after", help: "Tags with more tracks than this start folded.", kind: "int", default: 20, min: 1, max: 500 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-settings-surface-"));

function setup(answer?: (request: SettingsRequest) => string | null) {
  const warnings: string[] = [];
  const registry = createSettingsRegistry((t) => warnings.push(t));
  registry.declare("tag", { heading: "Tags", items: [foldAfter] });
  const dir = tmp();
  const store = createSettingsStore({ base: dir, registry, warn: (t) => warnings.push(t) });
  const requests: SettingsRequest[] = [];
  const logged: string[] = [];
  const flow = createSettingsFlow({
    registry,
    store,
    log: (l) => logged.push(l),
    ui: { settings: async (request) => (requests.push(request), parseSettingsAnswer(answer?.(request) ?? null, request, (l) => logged.push(l))) },
  });
  return { flow, requests, store, dir, warnings, logged, registry };
}

test("the request has core's groups first, then the modules' by name, with current values and defaults", async () => {
  const { requests, flow, store } = setup();
  await store.set({ "tag.foldAfter": 3, "palette.above": "hints" });
  await flow.open();
  const r = requests[0]!;
  assert.equal(r.title, "cmdAbl Settings");
  assert.deepEqual(r.groups.map((g) => g.id), ["cmdabl", "map", "midi", "tag"]);
  const tag = r.groups[3]!.items[0]!;
  assert.deepEqual(tag, { key: "tag.foldAfter", label: "Fold after", help: foldAfter.help, kind: "int", value: 3, default: 20, min: 1, max: 500 });
  const above = r.groups[0]!.items[0]!;
  assert.equal(above.kind === "enum" && above.value, "hints");
  assert.equal(r.focus, undefined);
});

test("`only` limits the page to one group and names it; a group focuses; an unknown group is exit 3", async () => {
  const { requests, flow } = setup();
  await flow.open({ group: "tag", only: true });
  assert.equal(requests[0]!.title, "tag Settings");
  assert.deepEqual(requests[0]!.groups.map((g) => g.id), ["tag"]);
  assert.equal(requests[0]!.focus, "tag");
  await flow.open({ group: "map" });
  assert.equal(requests[1]!.focus, "map");
  assert.equal(requests[1]!.groups.length, 4);
  const missing = await flow.open({ group: "nope" });
  assert.equal(missing.code, ExitCode.NOT_FOUND);
  assert.match(missing.message!, /groups: cmdabl, map, midi, tag/);
  assert.equal(requests.length, 2);
});

test("an answer is saved after the page closed, with one result line; the file keeps unknown keys", async () => {
  const { flow, store, dir } = setup(() => JSON.stringify({ changes: { "tag.foldAfter": 3, "map.enabled": false, "nope.key": 1 } }));
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ "future.key": 1 }));
  const result = await flow.open();
  assert.equal(result.code, ExitCode.OK);
  assert.equal(result.message, "2 settings saved");
  assert.deepEqual(result.log, ['set tag.foldAfter = 3', 'set map.enabled = false']);
  const values = await store.get();
  assert.equal(values["tag.foldAfter"], 3);
  assert.equal(values["map.enabled"], false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8"))["future.key"], 1);
  const one = setup(() => JSON.stringify({ changes: { "tag.foldAfter": 7 } }));
  assert.equal((await one.flow.open()).message, "1 setting saved");
});

test("closing without Enter, an unreadable answer, and an answer without changes save nothing and say nothing", async () => {
  for (const answer of [null, "", "nope", "[]", JSON.stringify({ changes: { "tag.foldAfter": 20 } }), JSON.stringify({})]) {
    const t = setup(() => answer);
    const result = await t.flow.open();
    assert.deepEqual(result, { code: 0 }, String(answer));
    assert.deepEqual(fs.readdirSync(t.dir), [], String(answer));
  }
});

test("a file that cannot be written is exit 1, never a throw", async () => {
  const t = setup(() => JSON.stringify({ changes: { "tag.foldAfter": 5 } }));
  fs.rmSync(t.dir, { recursive: true });
  fs.writeFileSync(t.dir, "a file where the folder should be");
  const result = await t.flow.open();
  assert.equal(result.code, ExitCode.FAILURE);
  assert.match(result.message!, /could not be saved/);
  assert.equal((await t.store.get())["tag.foldAfter"], 5); // in effect for this session
});

test("a page that throws is exit 1, not an exception", async () => {
  const t = setup();
  const flow = createSettingsFlow({ registry: t.registry, store: t.store, ui: { settings: async () => Promise.reject(new Error("boom")) } });
  assert.equal((await flow.open()).code, ExitCode.FAILURE);
});

test("parseSettingsAnswer drops unknown keys, wrong kinds, out-of-range values, no-ops and unknown link targets", () => {
  const request = capSettings(fixture as unknown as SettingsRequest).request;
  const answer = (value: unknown) => parseSettingsAnswer(JSON.stringify(value), request, () => {});
  assert.deepEqual(answer({ changes: { "tag.foldAfter": 3 } }), { changes: { "tag.foldAfter": 3 } });
  assert.deepEqual(answer({ changes: { "tag.foldAfter": 0 } })?.changes, {}); // below min
  assert.deepEqual(answer({ changes: { "tag.foldAfter": 501 } })?.changes, {});
  assert.deepEqual(answer({ changes: { "tag.foldAfter": 2.5 } })?.changes, {});
  assert.deepEqual(answer({ changes: { "tag.foldAfter": "3" } })?.changes, {});
  assert.deepEqual(answer({ changes: { "tag.foldAfter": 20 } })?.changes, {}); // no-op
  assert.deepEqual(answer({ changes: { "palette.above": "options" } })?.changes, { "palette.above": "options" });
  assert.deepEqual(answer({ changes: { "palette.above": "both" } })?.changes, {}); // not a choice
  assert.deepEqual(answer({ changes: { "palette.above": "hints" } })?.changes, {}); // no-op (the request's value)
  assert.deepEqual(answer({ changes: { "map.enabled": true } })?.changes, { "map.enabled": true });
  assert.deepEqual(answer({ changes: { "map.enabled": 1 } })?.changes, {});
  assert.deepEqual(answer({ changes: { unknown: 1, "link:defaults": "x" } })?.changes, {}); // unknown key, link row
  assert.deepEqual(answer({ changes: { "map.enabled": true }, open: "defaults" }), { changes: { "map.enabled": true }, open: "defaults" });
  assert.deepEqual(answer({ changes: {}, open: "elsewhere" }), { changes: {} }); // only a link row's target
  assert.deepEqual(answer({ changes: [1] }), { changes: {} });
  for (const bad of [null, "", "nope", "[]", "5"]) assert.equal(parseSettingsAnswer(bad as never, request, () => {}), null, String(bad));
});

test("the fixture (every row kind) is a valid request that capping leaves as it is", () => {
  const { request, cut } = capSettings(fixture as unknown as SettingsRequest);
  assert.equal(cut, false);
  assert.deepEqual(request, fixture);
  const kinds = new Set(request.groups.flatMap((g) => g.items.map((i) => i.kind)));
  assert.deepEqual([...kinds].sort(), ["bool", "enum", "int", "link"]);
});

test("capSettings: 20 groups × 50 rows, texts up to 300 characters, rows without a key or kind dropped", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: "x".repeat(400), help: "h", kind: "bool" as const, value: true, default: false }));
  const groups = Array.from({ length: MAX_GROUPS + 3 }, (_, i) => ({ id: `g${i}`, heading: "H", items: i === 0 ? [...rows(MAX_ROWS + 5), { key: "", label: "x", help: "", kind: "bool" as const, value: true, default: true }, { key: "weird", label: "w", help: "", kind: "other" } as never] : [] }));
  const { request, cut } = capSettings({ title: "t", groups });
  assert.equal(cut, true);
  assert.equal(request.groups.length, MAX_GROUPS);
  assert.equal(request.groups[0]!.items.length, MAX_ROWS);
  assert.equal(request.groups[0]!.items[0]!.label.length, 300);
  assert.equal(capSettings({ title: "t", focus: "nope", groups: [{ id: "a", heading: "A", items: [] }] }).request.focus, undefined);
  // an int row whose values do not fit its range is clamped to a valid one; an enum without choices is dropped
  const odd = capSettings({
    title: "t",
    groups: [{ id: "a", heading: "A", items: [{ key: "a.n", label: "n", help: "", kind: "int", value: 99, default: 0, min: 1, max: 5 }, { key: "a.e", label: "e", help: "", kind: "enum", value: "x", default: "x", choices: [] }] }],
  });
  assert.deepEqual(odd.request.groups[0]!.items.map((i) => i.key), ["a.n"]);
  assert.equal(odd.cut, true);
});

test("buildSettingsRequest falls back to the default for a value that does not fit", () => {
  const registry = createSettingsRegistry();
  registry.declare("tag", { heading: "Tags", items: [foldAfter] });
  const r = buildSettingsRequest(registry.groups(), { "tag.foldAfter": 9999 }, { title: "t" });
  const row = r.groups.find((g) => g.id === "tag")!.items[0]!;
  assert.equal(row.kind === "int" && row.value, 20);
});

test("isGearAnswer: exactly settings:true; settingsSize stays within the dialog limits", () => {
  assert.equal(isGearAnswer('{"settings":true}'), true);
  assert.equal(isGearAnswer('{"settings":true,"text":"tag --list"}'), true);
  for (const no of [null, "", "nope", '{"settings":{"above":"off"}}', '{"settings":false}', "[true]"]) assert.equal(isGearAnswer(no), false, String(no));
  const small = settingsSize({ title: "t", groups: [{ id: "a", heading: "A", items: [] }] });
  const big = settingsSize(capSettings({ title: "t", groups: Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, heading: "H", items: [] })) }).request);
  assert.ok(small.height >= 260 && big.height <= 560 && small.width === 560);
});

test("a link row's open target is opened after the changes were saved (phase 1b)", async () => {
  const t = setup();
  const order: string[] = [];
  const flow = createSettingsFlow({
    registry: t.registry,
    store: {
      get: () => t.store.get(),
      set: async (patch) => (order.push("saved"), t.store.set(patch)),
    },
    onOpen: async (target) => void order.push(`open ${target}`),
    ui: { settings: async () => ({ changes: { "tag.foldAfter": 4 }, open: "defaults" } satisfies SettingsAnswer) },
  });
  assert.equal((await flow.open()).message, "1 setting saved");
  assert.deepEqual(order, ["saved", "open defaults"]);
});

test("link rows core adds reach the page (after the declared rows) and what the opened page saved is told too", async () => {
  const t = setup();
  const seen: SettingsRequest[] = [];
  const flow = createSettingsFlow({
    registry: t.registry,
    store: t.store,
    links: async (group) => (group === "cmdabl" ? [{ key: "link:defaults", label: "Default commands", help: "h", kind: "link", target: "defaults", summary: "2 set" }] : group === "tag" ? [{ key: "link:defaults:tag", label: "Default command", help: "h", kind: "link", target: "defaults:tag", summary: "not set" }] : []),
    onOpen: async () => ({ code: ExitCode.OK, message: "1 default command saved", log: ["default tag = tag -l"] }),
    ui: { settings: async (request) => (seen.push(request), { changes: { "tag.foldAfter": 4 }, open: "defaults:tag" } satisfies SettingsAnswer) },
  });
  const out = await flow.open();
  const rows = (id: string) => seen[0]!.groups.find((g) => g.id === id)!.items;
  assert.equal(rows("cmdabl").at(-1)!.kind, "link");
  assert.equal((rows("tag").at(-1) as { target: string }).target, "defaults:tag");
  assert.equal(out.message, "1 setting saved, 1 default command saved");
  assert.deepEqual(out.log?.at(-1), "default tag = tag -l");
  // a throwing link source only means no link rows
  const broken = createSettingsFlow({ registry: t.registry, store: t.store, links: async () => Promise.reject(new Error("x")), ui: { settings: async (request) => (seen.push(request), null) } });
  assert.equal((await broken.open()).code, ExitCode.OK);
  assert.ok(seen[1]!.groups.every((g) => g.items.every((r) => r.kind !== "link")));
});
