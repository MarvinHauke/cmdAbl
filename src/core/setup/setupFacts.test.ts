import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gatherFacts, KARABINER_RULE_DESCRIPTION, ruleEnabledIn, writableFolder } from "./setupFacts.js";
import { isKarabinerSetupDone, runMacRemoteScriptSetup } from "./setup.js";
import { isKarabinerImportUrl, KARABINER_SETTINGS_URL, openUrl } from "./openUrl.js";
import { sectionsSize, sectionsText, usesStatusLayout } from "../surfaces/notifySize.js";
import { karabinerImportUrl } from "./setupRows.js";

const config = (profiles: unknown) => JSON.stringify({ profiles });
const rule = { description: KARABINER_RULE_DESCRIPTION };

test("ruleEnabledIn: the selected profile lists the rule; none lists it; unreadable is null", () => {
  assert.equal(ruleEnabledIn(config([{ selected: true, complex_modifications: { rules: [rule] } }])), true);
  assert.equal(ruleEnabledIn(config([{ selected: false, complex_modifications: { rules: [rule] } }, { selected: true, complex_modifications: { rules: [] } }])), false);
  assert.equal(ruleEnabledIn(config([{ selected: true }])), false);
  assert.equal(ruleEnabledIn(null), null);
  assert.equal(ruleEnabledIn("{nope"), null);
  assert.equal(ruleEnabledIn("{}"), null);
});

test("the rule's description in karabiner/cmdabl.json is the one ruleEnabledIn looks for", () => {
  const file = JSON.parse(fs.readFileSync(path.join(typeof __dirname === "string" ? path.resolve(__dirname, "../../..") : process.cwd(), "karabiner/cmdabl.json"), "utf8"));
  assert.equal(file.rules[0].description, KARABINER_RULE_DESCRIPTION);
});

test("gatherFacts: copy newer than the host start, a failing probe is unknown, a throwing ping is not asked", async () => {
  const base = { port: 27184, controlSurfaceUrl: "u", triggerInstalled: () => true, triggerRuleThere: () => true, karabinerConfig: () => null, hostStart: 1000, dataFolder: "/x", writable: () => true, installed: () => ({ status: "current" as const, version: "1" }) };
  const newer = await gatherFacts({ ...base, platform: "darwin", scriptTime: () => 2000 });
  assert.equal(newer.script.copyNewerThanHost, true);
  assert.equal(newer.trigger.enabled, null);
  assert.equal((await gatherFacts({ ...base, scriptTime: () => 500 })).script.copyNewerThanHost, false);
  assert.equal((await gatherFacts({ ...base, scriptTime: () => null })).script.copyNewerThanHost, null);
  const odd = await gatherFacts({ ...base, triggerInstalled: () => { throw new Error("x"); }, ping: async () => { throw new Error("y"); }, scriptTime: () => null });
  assert.equal(odd.trigger.installed, false);
  assert.equal(odd.script.running, null);
  assert.equal(odd.importUrl, karabinerImportUrl(27184));
});

test("writableFolder: a temp folder is, a path under a file is not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-w-"));
  assert.equal(writableFolder(dir), true);
  const file = path.join(dir, "f");
  fs.writeFileSync(file, "x");
  assert.equal(writableFolder(path.join(file, "sub")), false);
});

test("setup script against a temp folder: copies, updates over an older copy, and leaves a linked folder alone", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-copy-"));
  const source = path.join(root, "src", "cmdAbl");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "protocol.py"), 'VERSION = "2"\n');
  const target = path.join(root, "Remote Scripts", "cmdAbl");
  const first = runMacRemoteScriptSetup(source, target);
  assert.equal(first.ok, true);
  assert.equal(fs.readFileSync(path.join(target, "protocol.py"), "utf8"), 'VERSION = "2"\n');
  fs.writeFileSync(path.join(target, "protocol.py"), 'VERSION = "1"\n');
  assert.equal(runMacRemoteScriptSetup(source, target).ok, true);
  assert.equal(fs.readFileSync(path.join(target, "protocol.py"), "utf8"), 'VERSION = "2"\n');
  const same = runMacRemoteScriptSetup(source, source);
  assert.equal(same.ok, true);
  assert.match(same.text, /nothing to copy/);
  const missing = runMacRemoteScriptSetup(path.join(root, "nope"), target);
  assert.equal(missing.ok, false);
  assert.match(missing.text, /source not found/);
});

test("openUrl accepts Karabiner's import link and nothing else but https", async () => {
  const url = karabinerImportUrl(27184);
  assert.equal(isKarabinerImportUrl(url), true);
  for (const bad of ["karabiner://karabiner/assets/complex_modifications/import?url=a b", "karabiner://other/x", `${url}&x=1`, "file:///etc/passwd", "karabiner://karabiner/assets/complex_modifications/import?url=a;rm"]) {
    assert.equal(isKarabinerImportUrl(bad), false, bad);
  }
  const opened: string[][] = [];
  const spawn = ((cmd: string, args: string[]) => {
    opened.push([cmd, ...args]);
    const handlers: Record<string, () => void> = {};
    setImmediate(() => handlers.spawn?.());
    return { once: (e: string, f: () => void) => void (handlers[e] = f), unref() {} };
  }) as never;
  assert.equal((await openUrl(url, { platform: "darwin", spawn })).code, 0);
  assert.deepEqual(opened, [["open", url]]);
  assert.equal((await openUrl("karabiner://x", { platform: "darwin", spawn })).code, 1);
  opened.length = 0;
  assert.equal((await openUrl(KARABINER_SETTINGS_URL, { platform: "darwin", spawn })).code, 0);
  assert.deepEqual(opened, [["open", "karabiner://karabiner/"]]);
  for (const bad of ["karabiner://karabiner/x", "karabiner://karabiner/?a", "karabiner://karabiner", "karabiner://karabiner/ "]) {
    assert.equal((await openUrl(bad, { platform: "darwin", spawn })).code, 1, bad);
  }
});

test("sectionsSize: the setup page's boxes add up (4 rows in 3 sections plus the checkbox ≈ the measured need); plain sections keep the old sizing", () => {
  const setup = [
    { heading: "Keyboard trigger", items: [{ text: "The : key opens cmdAbl.", status: "ok" as const }] },
    { heading: "Remote Script", items: [{ text: "Remote Script 0.1.14 is installed.", status: "ok" as const }, { text: "cmdAbl answers in Live.", status: "ok" as const }] },
    { heading: "Data folder", items: [{ text: "Settings and tags can be saved.", status: "ok" as const }] },
  ];
  const size = sectionsSize(setup, { toggle: true });
  assert.ok(size.height >= 330 && size.height <= 370, String(size.height)); // 32 + 54 + 15 + 4×24 + 4 + 42 + 12 + 36 + 12 + 24 + slack
  assert.ok(sectionsSize(setup, { toggle: false }).height < size.height); // no help line without a button or checkbox
  const long = [{ heading: "h", items: [{ text: "x".repeat(300), status: "warn" as const, action: { label: "Go", command: "c" } }] }];
  assert.ok(sectionsSize(long, { toggle: false }).height > sectionsSize([{ heading: "h", items: [{ text: "x", status: "warn" as const, action: { label: "Go", command: "c" } }] }], { toggle: false }).height);
  assert.equal(usesStatusLayout([{ heading: "h", items: ["a"] }], false), false);
  assert.equal(usesStatusLayout([{ heading: "h", items: ["a"] }], true), true);
  assert.equal(usesStatusLayout(setup, false), true);
  assert.match(sectionsText([{ heading: "h", items: [{ text: "row", status: "ok", action: { label: "Go", command: "c" } }, "plain"] }]), /row {2}\[Go\]/);
});

test("gatherFacts (macOS): a rule enabled in karabiner.json counts as added whatever the asset file is called", async () => {
  const base = { platform: "darwin" as const, port: 27184, controlSurfaceUrl: "u", triggerInstalled: () => true, hostStart: 1000, dataFolder: "/x", writable: () => true, installed: () => ({ status: "current" as const, version: "1" }), scriptTime: () => null };
  const withRule = JSON.stringify({ profiles: [{ selected: true, complex_modifications: { rules: [{ description: KARABINER_RULE_DESCRIPTION }] } }] });
  const none = JSON.stringify({ profiles: [{ selected: true, complex_modifications: { rules: [] } }] });
  const enabled = await gatherFacts({ ...base, triggerRuleThere: () => false, karabinerConfig: () => withRule });
  assert.deepEqual([enabled.trigger.ruleThere, enabled.trigger.enabled], [true, true]);
  const added = await gatherFacts({ ...base, triggerRuleThere: () => true, karabinerConfig: () => none });
  assert.deepEqual([added.trigger.ruleThere, added.trigger.enabled], [true, false]);
  const missing = await gatherFacts({ ...base, triggerRuleThere: () => false, karabinerConfig: () => none });
  assert.deepEqual([missing.trigger.ruleThere, missing.trigger.enabled], [false, null]);
});

test("isKarabinerSetupDone finds the rule in a timestamp-named file", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-k-"));
  fs.writeFileSync(path.join(dir, "other.json"), "{}");
  assert.equal(isKarabinerSetupDone(dir), false);
  fs.writeFileSync(path.join(dir, "1794450424.json"), JSON.stringify({ rules: [{ description: KARABINER_RULE_DESCRIPTION }] }));
  assert.equal(isKarabinerSetupDone(dir), true);
  assert.equal(isKarabinerSetupDone(path.join(dir, "nothing")), false);
  fs.rmSync(dir, { recursive: true });
});
