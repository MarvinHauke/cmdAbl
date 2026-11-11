import { test } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CommandRegistry } from "./commandRegistry.js";
import { ok } from "../types.js";
import { bareBehaviour, checkDefaultLine, createDefaultsStore, DEFAULTS_FILE, expandDefaults } from "./defaultCommands.js";
import { rootCommandOf } from "./parse.js";
import { runLine } from "./run.js";

function tree() {
  const registry = new CommandRegistry();
  registry.add({ name: "mute", summary: "mute", options: [{ name: "set", takesValue: true, summary: "set" }], args: [{ name: "track", kind: "text", variadic: true }], run: () => ok("mute ran") });
  registry.add({ name: "note", summary: "note", options: [{ name: "edit", short: "e", summary: "edit" }], args: [{ name: "text", kind: "text", required: false, rest: true }], run: () => ok("note ran") });
  registry.add({ name: "midi", summary: "midi", children: [{ name: "monitor", summary: "monitor", run: () => ok("monitor ran") }] });
  registry.add({ name: "solo", summary: "solo", args: [{ name: "track", kind: "text", variadic: true }], run: () => ok("solo ran") });
  return registry;
}

test("checkDefaultLine: a line that parses and starts with its own command is fine; the rest says why not", () => {
  const roots = tree().roots();
  assert.equal(checkDefaultLine("mute", "mute #drums", roots), null);
  assert.equal(checkDefaultLine("mute", "mute #drums; solo #x", roots), null);
  assert.equal(checkDefaultLine("note", "note -e", roots), null);
  assert.match(checkDefaultLine("mute", "solo #x", roots)!, /must start with its own command "mute"/);
  assert.match(checkDefaultLine("mute", "muted #x", roots)!, /must start with/);
  assert.match(checkDefaultLine("mute", '"mute" #x', roots)!, /must start with/);
  assert.match(checkDefaultLine("mute", "mute --bogus 1", roots)!, /unknown option/);
  assert.match(checkDefaultLine("mute", "mute --help", roots)!, /only shows help/);
  assert.match(checkDefaultLine("midi", "midi", roots)!, /only shows help/);
  assert.match(checkDefaultLine("mute", "mute #a; bogus", roots)!, /unknown command/);
  assert.match(checkDefaultLine("mute", "", roots)!, /empty/);
  assert.match(checkDefaultLine("mute", "mute " + "x".repeat(400), roots)!, /longer than/);
  assert.match(checkDefaultLine("mute", 5, roots)!, /text/);
  assert.equal(checkDefaultLine("midi", "midi monitor", roots), null);
});

test("bareBehaviour: a group shows its subcommands, a required argument is needed, else it runs", () => {
  const roots = tree().roots();
  assert.equal(bareBehaviour(roots.find((n) => n.name === "midi")!), "shows its subcommands");
  assert.equal(bareBehaviour(roots.find((n) => n.name === "note")!), "runs on its own");
  const need = new CommandRegistry();
  need.add({ name: "vol", summary: "v", args: [{ name: "value", kind: "number" }], run: () => ok() });
  assert.equal(bareBehaviour(need.roots()[0]!), "needs <value>");
});

test("expandDefaults: only a bare top-level word expands, each ; part on its own", () => {
  const defaults = { mute: "mute #drums", note: "note -e" };
  assert.deepEqual(expandDefaults("mute", defaults), { line: "mute #drums", expansions: [{ typed: "mute", ran: "mute #drums" }] });
  assert.equal(expandDefaults("  mute  ", defaults).line, "  mute #drums  "); // the spaces around stay
  assert.equal(expandDefaults("mute bass", defaults).line, "mute bass"); // anything after the word: no default
  assert.equal(expandDefaults("mute --set 1", defaults).line, "mute --set 1");
  assert.equal(expandDefaults("\\mute", defaults).line, "\\mute"); // skipped: the raw line starts with a backslash
  assert.equal(expandDefaults('"mute"', defaults).line, '"mute"');
  assert.equal(expandDefaults("solo", defaults).line, "solo"); // no default for it
  const chain = expandDefaults("mute; solo; note", defaults);
  assert.equal(chain.line, "mute #drums; solo; note -e");
  assert.equal(chain.expansions.length, 2);
  assert.equal(expandDefaults("mute;mute bass; \\note", defaults).line, "mute #drums;mute bass; \\note");
  // a binding's line (after the pipe) is expanded when it fires, not now
  assert.equal(expandDefaults("map CC48 | mute", defaults).line, "map CC48 | mute");
  assert.equal(expandDefaults("mute | x", defaults).line, "mute | x");
  // not expanded again, even when the default holds the word
  assert.equal(expandDefaults("mute", { mute: "mute; mute" }).line, "mute; mute");
  assert.equal(expandDefaults("mute", {}).line, "mute");
  assert.equal(expandDefaults("constructor", {}).line, "constructor");
  assert.equal(expandDefaults("constructor", defaults).line, "constructor"); // not an own key
});

test("rootCommandOf: the parsed root, also for \\word, quoted, options and a usage error", () => {
  const roots = tree().roots();
  assert.equal(rootCommandOf("mute #a", roots), "mute");
  assert.equal(rootCommandOf("\\mute", roots), "mute");
  assert.equal(rootCommandOf("  note -e", roots), "note");
  assert.equal(rootCommandOf("midi monitor", roots), "midi");
  assert.equal(rootCommandOf("mute --bogus", roots), "mute"); // a usage error is still about mute
  assert.equal(rootCommandOf("mute; solo", roots), undefined);
  assert.equal(rootCommandOf("nothing", roots), undefined);
  assert.equal(rootCommandOf("", roots), undefined);
});

async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cmdabl-defaults-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("store: a missing file means no defaults; set writes and removes; unknown and invalid entries stay in the file", async () => {
  await inTemp(async (dir) => {
    const warnings: string[] = [];
    const store = createDefaultsStore({ base: dir, roots: () => tree().roots(), warn: (t) => warnings.push(t) });
    assert.deepEqual(await store.get(), {});
    assert.deepEqual(warnings, []);
    assert.equal(await store.set({ mute: "mute #drums" }), true);
    assert.deepEqual(await store.get(), { mute: "mute #drums" });
    // hand edit: an unknown command, one that does not start with its own command, a non-text value
    await fsp.writeFile(path.join(dir, DEFAULTS_FILE), JSON.stringify({ mute: "mute #drums", solo: "mute #x", gone: "gone x", note: "note -e", other: 5 }), "utf8");
    assert.deepEqual(await store.get(), { mute: "mute #drums", note: "note -e" }); // re-read: the stamp changed
    assert.equal(warnings.length, 2); // solo and gone, once each
    const entries = await store.entries();
    assert.equal(entries.find((e) => e.command === "solo")!.error !== undefined, true);
    assert.equal(entries.find((e) => e.command === "other"), undefined);
    await store.get();
    assert.equal(warnings.length, 2); // no new warning without a change
    assert.equal(await store.set({ note: "" }), true);
    const written = JSON.parse(await fsp.readFile(path.join(dir, DEFAULTS_FILE), "utf8"));
    assert.deepEqual(written, { mute: "mute #drums", solo: "mute #x", gone: "gone x", other: 5 }); // the invalid and unknown ones stay
    assert.deepEqual(await fsp.readdir(dir), [DEFAULTS_FILE]); // no temp file left
  });
});

test("store: no write when nothing changes; a broken file and a failing write never throw", async () => {
  await inTemp(async (dir) => {
    const warnings: string[] = [];
    const store = createDefaultsStore({ base: dir, roots: () => tree().roots(), warn: (t) => warnings.push(t) });
    assert.equal(await store.set({ mute: "" }), true);
    assert.deepEqual(await fsp.readdir(dir), []); // nothing to remove: no file
    await fsp.writeFile(path.join(dir, DEFAULTS_FILE), "{ not json", "utf8");
    assert.deepEqual(await store.get(), {});
    assert.match(warnings.at(-1)!, /not a JSON object/);
  });
});

test("store: set keeps the new value in effect even when the file cannot be written", async () => {
  await inTemp(async (dir) => {
    const warnings: string[] = [];
    const blocked = path.join(dir, "file");
    await fsp.writeFile(blocked, "x", "utf8"); // a file where the folder should be
    const store = createDefaultsStore({ base: blocked, roots: () => tree().roots(), warn: (t) => warnings.push(t) });
    assert.equal(await store.set({ mute: "mute #a" }), false);
    assert.deepEqual(await store.get(), { mute: "mute #a" });
  });
});

test("run: a bare word runs its default, logs typed ⇒ ran, and reports the typed form", async () => {
  const registry = tree();
  const ran: string[] = [];
  registry.add({ name: "play", summary: "p", args: [{ name: "x", kind: "text", required: false }], run: (inv) => (ran.push(`play ${inv.args[0]?.[0] ?? ""}`.trim()), ok()) });
  const log: string[] = [];
  const deps = { registry, liveNodes: () => [], pick: async () => null, log: (l: string) => log.push(l), defaults: async () => ({ play: "play loud", mute: "mute x" }) };
  const out = await runLine("play", deps);
  assert.deepEqual(ran, ["play loud"]);
  assert.equal(out.typed, "play");
  assert.equal(out.line, "play loud");
  assert.ok(log.includes("cmdAbl [run] info: play ⇒ play loud (default)"), log.join("\n"));
  ran.length = 0;
  const skipped = await runLine("\\play", deps);
  assert.deepEqual(ran, ["play"]);
  assert.equal(skipped.typed, undefined);
  ran.length = 0;
  const chain = await runLine("play; play quiet", deps);
  assert.deepEqual(ran, ["play loud", "play quiet"]);
  assert.equal(chain.typed, "play; play quiet");
  // a defaults source that throws never stops the command
  ran.length = 0;
  await runLine("play", { ...deps, defaults: async () => { throw new Error("disk"); } });
  assert.deepEqual(ran, ["play"]);
});
