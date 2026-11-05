import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CommandRegistry } from "./commandRegistry.js";
import { ExitCode, ok } from "./types.js";
import type { DefaultEntry, DefaultsStore } from "./defaultCommands.js";
import { checkDefaultLine } from "./defaultCommands.js";
import { buildDefaultsRequest, capDefaults, createDefaultsFlow, defaultsSize, parseDefaultsAnswer } from "./defaultsSurface.js";
import type { DefaultsAnswer, DefaultsRequest } from "./ui.js";
import { registerBuiltins } from "./builtins.js";
import { runLine } from "./run.js";
import { buildCompletionData } from "./completeSnapshot.js";

function tree() {
  const registry = new CommandRegistry();
  registry.add({ name: "mute", summary: "mute tracks", args: [{ name: "track", kind: "text", variadic: true }], run: () => ok() });
  registry.add({ name: "note", summary: "notes", options: [{ name: "edit", short: "e", summary: "edit" }], args: [{ name: "text", kind: "text", required: false, rest: true }], run: () => ok() });
  registry.add({ name: "midi", summary: "midi", children: [{ name: "monitor", summary: "monitor", run: () => ok() }] });
  return registry;
}

/** A store in memory with the real checking rules. */
function memoryStore(roots: () => ReturnType<CommandRegistry["roots"]>, start: Record<string, string> = {}) {
  const content: Record<string, string> = { ...start };
  const sets: Array<Record<string, string>> = [];
  let fail = false;
  const entries = (): DefaultEntry[] =>
    Object.entries(content).map(([command, line]) => {
      const error = checkDefaultLine(command, line, roots());
      return { command, line, ...(error ? { error } : {}) };
    });
  const store: DefaultsStore = {
    get: async () => Object.fromEntries(entries().filter((e) => !e.error).map((e) => [e.command, e.line])),
    peek: () => Object.fromEntries(entries().filter((e) => !e.error).map((e) => [e.command, e.line])),
    entries: async () => entries(),
    set: async (changes) => {
      sets.push({ ...changes });
      if (fail) return false;
      for (const [c, l] of Object.entries(changes)) {
        if (l === "") delete content[c];
        else content[c] = l;
      }
      return true;
    },
  };
  return { store, content, sets, failNext: () => (fail = true) };
}

const request = (rows: Array<Partial<DefaultsRequest["rows"][number]> & { command: string }>): DefaultsRequest => ({
  title: "Default commands",
  rows: rows.map((r) => ({ line: "", summary: "", bareBehaviour: "", ...r })),
});

test("buildDefaultsRequest: one row per top-level command with its line, summary and bare behaviour", () => {
  const registry = tree();
  const r = buildDefaultsRequest(registry.roots(), [{ command: "mute", line: "mute #drums" }, { command: "note", line: "nope", error: "bad" }], { focus: "note" });
  assert.deepEqual(r.rows.map((x) => x.command), ["mute", "note", "midi"]);
  assert.equal(r.rows[0]!.line, "mute #drums");
  assert.equal(r.rows[0]!.bareBehaviour, "needs <track>");
  assert.equal(r.rows[1]!.error, "bad");
  assert.equal(r.rows[2]!.bareBehaviour, "shows its subcommands");
  assert.equal(r.focus, "note");
  assert.equal(buildDefaultsRequest(registry.roots(), [], { focus: "zzz" }).focus, undefined);
  // the text of a failed save wins over the stored line
  const typed = buildDefaultsRequest(registry.roots(), [{ command: "mute", line: "mute #a" }], { typed: { mute: { line: "solo", error: "must start" } } });
  assert.equal(typed.rows[0]!.line, "solo");
  assert.equal(typed.rows[0]!.error, "must start");
  assert.equal(typed.rows[0]!.saved, "mute #a"); // the stored line, to compare against
  assert.equal(buildDefaultsRequest(registry.roots(), [], { typed: { mute: { line: "solo", error: "e" } } }).rows[0]!.saved, ""); // none stored
  assert.equal("saved" in buildDefaultsRequest(registry.roots(), [{ command: "mute", line: "mute #a" }]).rows[0]!, false); // first open: omitted
});

test("parseDefaultsAnswer compares against `saved ?? line`", () => {
  const req = { title: "t", rows: [{ command: "mute", line: "solo", summary: "", bareBehaviour: "", error: "e", saved: "mute #a" }] };
  assert.deepEqual(parseDefaultsAnswer(JSON.stringify({ changes: { mute: "solo" } }), req, () => {})!.changes, { mute: "solo" }); // typed text left as it is
  assert.deepEqual(parseDefaultsAnswer(JSON.stringify({ changes: { mute: "mute #a" } }), req, () => {})!.changes, {}); // put back to saved
});

test("capDefaults: rows and texts are capped, bad rows dropped", () => {
  const rows = Array.from({ length: 210 }, (_, i) => ({ command: `c${i}`, line: "", summary: "s", bareBehaviour: "b" }));
  const capped = capDefaults({ title: "t", rows: [...rows, { command: "", line: "", summary: "", bareBehaviour: "" }, { command: "c0", line: "", summary: "", bareBehaviour: "" }] });
  assert.equal(capped.request.rows.length, 200);
  assert.equal(capped.cut, true);
  const long = capDefaults({ title: "t", rows: [{ command: "a", line: "x".repeat(400), summary: "", bareBehaviour: "" }] });
  assert.equal(long.request.rows[0]!.line.length, 300);
  assert.equal(long.cut, true);
  assert.equal(capDefaults({ title: "t", focus: "zz", rows: [{ command: "a", line: "", summary: "", bareBehaviour: "" }] }).request.focus, undefined);
  assert.equal(capDefaults({ title: "t", rows: "no" as never }).request.rows.length, 0);
});

test("parseDefaultsAnswer: only real changes of known commands, text only, '' removes; nothing throws", () => {
  const req = request([{ command: "mute", line: "mute #a" }, { command: "note", line: "" }]);
  const logged: string[] = [];
  const parse = (raw: string | null) => parseDefaultsAnswer(raw, req, (l) => logged.push(l));
  assert.deepEqual(parse(JSON.stringify({ changes: { mute: "mute #b", note: "note -e" } })), { changes: { mute: "mute #b", note: "note -e" } });
  assert.deepEqual(parse(JSON.stringify({ changes: { mute: "", note: "" } })), { changes: { mute: "" } }); // note had no line: no change
  assert.deepEqual(parse(JSON.stringify({ changes: { mute: " mute #a ", zzz: "x", note: 5 } })), { changes: {} });
  assert.deepEqual(parse(JSON.stringify({ changes: { mute: "x".repeat(301) } })), { changes: {} });
  assert.deepEqual(parse(JSON.stringify({ changes: { __proto__: "x", mute: "mute 1" } })), { changes: { mute: "mute 1" } });
  assert.equal(parse(""), null);
  assert.equal(parse(null), null);
  assert.equal(parse("{ no"), null);
  assert.equal(parse("[1]"), null);
  assert.deepEqual(parse(JSON.stringify({ changes: [1] })), { changes: {} });
  assert.ok(logged.length >= 3);
});

test("defaultsSize: grows with the rows up to a maximum", () => {
  assert.ok(defaultsSize(request([{ command: "a" }])).height >= 280);
  assert.equal(defaultsSize(request(Array.from({ length: 100 }, (_, i) => ({ command: `c${i}` })))).height, 600);
});

function flowFor(answers: Array<(r: DefaultsRequest) => DefaultsAnswer | null>, start: Record<string, string> = {}) {
  const registry = tree();
  const mem = memoryStore(() => registry.roots(), start);
  const requests: DefaultsRequest[] = [];
  let n = 0;
  const flow = createDefaultsFlow({
    store: mem.store,
    roots: () => registry.roots(),
    ui: {
      defaults: async (r) => {
        requests.push(r);
        const next = answers[n++];
        return next ? next(r) : null;
      },
    },
    log: () => {},
  });
  return { flow, mem, requests, registry };
}

test("flow: valid lines are saved and told; removal with ''", async () => {
  const t = flowFor([() => ({ changes: { mute: "mute #drums", note: "note -e" } })], { midi: "midi monitor" });
  const out = await t.flow.open();
  assert.equal(out.code, ExitCode.OK);
  assert.equal(out.message, "2 default commands saved");
  assert.deepEqual(t.mem.content, { midi: "midi monitor", mute: "mute #drums", note: "note -e" });
  assert.deepEqual(out.log, ["default mute = mute #drums", "default note = note -e"]);
  const removing = flowFor([() => ({ changes: { mute: "" } })], { mute: "mute #a" });
  assert.equal((await removing.flow.open()).message, "1 removed");
  assert.deepEqual(removing.mem.content, {});
});

test("flow: closing without Enter changes nothing and says nothing", async () => {
  const t = flowFor([() => null]);
  const out = await t.flow.open();
  assert.equal(out.code, ExitCode.OK);
  assert.equal(out.message, undefined);
  assert.deepEqual(t.mem.sets, []);
});

test("flow: an invalid line reopens the page on its row with the text and the error; valid ones are saved meanwhile", async () => {
  const t = flowFor([
    () => ({ changes: { mute: "note x", note: "note -e" } }),
    (r) => {
      assert.equal(r.focus, "mute");
      const row = r.rows.find((x) => x.command === "mute")!;
      assert.equal(row.line, "note x");
      assert.match(row.error!, /must start with its own command "mute"/);
      assert.equal(r.rows.find((x) => x.command === "note")!.line, "note -e"); // saved at once
      return { changes: { mute: "mute #fixed" } };
    },
  ]);
  const out = await t.flow.open();
  assert.equal(t.requests.length, 2);
  assert.deepEqual(t.mem.content, { note: "note -e", mute: "mute #fixed" });
  assert.equal(out.message, "2 default commands saved");
});

test("flow: Enter on the reopened page without a fix checks the pending line again; Esc ends it", async () => {
  const t = flowFor([() => ({ changes: { mute: "bogus" } }), () => ({ changes: { mute: "bogus" } }), () => null]);
  const out = await t.flow.open();
  assert.equal(t.requests.length, 3);
  assert.equal(t.requests[2]!.rows[0]!.line, "bogus");
  assert.deepEqual(t.mem.content, {});
  assert.equal(out.code, ExitCode.OK);
  assert.equal(out.message, "1 not saved (mute)");
});

test("flow: an endless run of bad answers stops", async () => {
  const t = flowFor(Array.from({ length: 50 }, () => () => ({ changes: { mute: "bogus" } })));
  await t.flow.open();
  assert.ok(t.requests.length <= 20);
});

test("flow: unknown focus is exit 3; a failing write is exit 1; a throwing page is exit 1; nothing throws", async () => {
  const t = flowFor([() => ({ changes: { mute: "mute #a" } })]);
  assert.equal((await t.flow.open({ focus: "zzz" })).code, ExitCode.NOT_FOUND);
  t.mem.failNext();
  assert.equal((await t.flow.open()).code, ExitCode.FAILURE);
  const registry = tree();
  const throwing = createDefaultsFlow({ store: memoryStore(() => registry.roots()).store, roots: () => registry.roots(), ui: { defaults: async () => Promise.reject(new Error("boom")) } });
  const out = await throwing.open();
  assert.equal(out.code, ExitCode.FAILURE);
  assert.match(out.message!, /boom/);
});

test("flow: openTarget takes defaults and defaults:<command>, nothing else", async () => {
  const t = flowFor([() => null, () => null]);
  await t.flow.openTarget("defaults");
  await t.flow.openTarget("defaults:note");
  assert.equal(t.requests[0]!.focus, undefined);
  assert.equal(t.requests[1]!.focus, "note");
  assert.equal((await t.flow.openTarget("other")).code, ExitCode.NOT_FOUND);
  assert.equal((await t.flow.openTarget("defaults:zzz")).code, ExitCode.NOT_FOUND);
});

test("flow: check answers ok or the usage error and never resolves targets", () => {
  const t = flowFor([]);
  assert.deepEqual(t.flow.check("mute", "mute #notyet"), { ok: true });
  const bad = t.flow.check("mute", "note");
  assert.equal(bad.ok, false);
  assert.equal(t.flow.check("zzz", "zzz").ok, false);
});

test("flow: summary counts the usable defaults of known commands", async () => {
  const t = flowFor([], { mute: "mute #a", note: "mute x", gone: "gone y" });
  const s = await t.flow.summary();
  assert.equal(s.count, 1);
  assert.deepEqual(s.lines, { mute: "mute #a" });
});

test("cmdabl config defaults [<command>] opens the defaults page; a second word without defaults is a usage error", async () => {
  const registry = tree();
  const opened: Array<{ focus?: string }> = [];
  registerBuiltins(registry, { settings: { open: async () => ok("settings"), groups: () => [] }, defaults: { open: async (o) => (opened.push(o ?? {}), ok("defaults")) } });
  const run = (line: string) => runLine(line, { registry, liveNodes: () => [], pick: async () => null });
  assert.equal((await run("cmdabl config defaults")).result.message, "defaults");
  assert.equal((await run("cmdabl config defaults mute")).result.message, "defaults");
  assert.deepEqual(opened, [{}, { focus: "mute" }]);
  assert.equal((await run("cmdabl config")).result.message, "settings");
  assert.equal((await run("cmdabl config tag extra")).result.code, ExitCode.USAGE);
});

test("the completion snapshot carries the usable defaults of known commands only, capped", async () => {
  const registry = tree();
  const data = await buildCompletionData({ roots: registry.roots(), completers: registry.completers(), nodes: () => [], defaults: async () => ({ mute: "mute #drums", gone: "gone x", note: "" }) });
  assert.deepEqual(data.defaults, { mute: "mute #drums" });
  const none = await buildCompletionData({ roots: registry.roots(), completers: registry.completers(), nodes: () => [] });
  assert.equal("defaults" in none, false);
  const broken = await buildCompletionData({ roots: registry.roots(), completers: registry.completers(), nodes: () => [], defaults: async () => { throw new Error("x"); } });
  assert.equal("defaults" in broken, false);
});

test("the fixture for the defaults page is a valid request", () => {
  const raw: unknown = JSON.parse(readFileSync(new URL("./defaultsRequest.fixture.json", import.meta.url), "utf8"));
  const { request: capped, cut } = capDefaults(raw as DefaultsRequest);
  assert.equal(cut, false);
  assert.deepEqual(capped, raw);
});

test("flow: lines that stay invalid when the page is closed are told, not dropped", async () => {
  const t = flowFor([() => ({ changes: { mute: "bogus", note: "note -e" } }), () => null]);
  const out = await t.flow.open();
  assert.equal(out.message, "1 default command saved, 1 not saved (mute)");
});
