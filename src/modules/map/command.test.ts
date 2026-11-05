import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import { validateTree } from "../../core/command/commandTree.js";
import { bindingRow } from "./store.js";
import { createFakeApi } from "../shared/testPorts.js";
import { registerMap } from "./command.js";
import { parseBindings, serializeBindings } from "./store.js";

const TEMPLATE = "<script>const CAPTURE = /*CAPTURE_PLACEHOLDER*/null; const LIVE = /*LIVE_PLACEHOLDER*/null;</script>";
type Result = { code: number; message?: string; log?: string[] } | undefined;
const msg = (seq: number, type: string, channel: number, number: number, value: number) => ({ seq, type, channel, number, value, time: seq }) as never;


/** A real script gets its messages while the page is open; the fake keeps them from the start: the first `last` call must see none. */
function arriveAfterOpen(fake: { api: { midi: { last: (since?: number) => Promise<unknown> } } }): void {
  const real = fake.api.midi.last;
  let calls = 0;
  fake.api.midi.last = (async (since = 0) => (calls++ === 0 ? { ok: true, value: { last: 0, messages: [] } } : real(since))) as never;
}

async function setup(options: Parameters<typeof createFakeApi>[0] = {}) {
  const fake = createFakeApi({ setId: "set1", ...options });
  fake.api.commands.add({ name: "mute", summary: "mute", run: () => undefined });
  fake.api.commands.add({ name: "solo", summary: "solo", run: () => undefined });
  const { sync } = registerMap(fake.api, TEMPLATE);
  await sync();
  arriveAfterOpen(fake as never);
  const map = fake.commands.find((c) => c.name === "map")!;
  const leaf = (name: string) => map.children!.find((c) => c.name === name)!;
  /** map [control] [operator] | line, with options. */
  const add = (args: { control?: string; operator?: string; line?: string }, opts: Record<string, string | true> = {}) =>
    leaf("add").run!(
      { path: ["map"], options: opts, args: [args.control ? [args.control] : [], args.operator ? [args.operator] : [], args.line ? [args.line] : []] } as never,
      undefined as never,
    ) as Promise<Result>;
  const learn = (operator: string | undefined, line: string) =>
    leaf("learn").run!({ path: ["map", "learn"], options: {}, args: [operator ? [operator] : [], [line]] } as never, undefined as never) as Promise<Result>;
  return { fake, map, add, learn };
}

test("the tree is valid and names a registered completer", async () => {
  const { fake, map } = await setup();
  assert.deepEqual(validateTree([map as never]), []);
  assert.deepEqual(fake.unknownCompleters(), []);
  assert.equal(map.children!.find((c) => c.fallback)?.name, "add");
});

test("adding a binding stores it in <setid>.json and hands it to the engine", async () => {
  const { fake, add } = await setup();
  const r = (await add({ control: "CC37", operator: "toggle", line: "solo #lead --set {}" }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.message!, /^map 1: CC37 toggle \| solo #lead --set \{\}/);
  assert.equal(fake.midiBindings.length, 1);
  assert.deepEqual(parseBindings(fake.fileStore.get("set1.json") ?? null).bindings.map((b) => b.line), ["solo #lead --set {}"]);
});

test("press is the default operator; the same control and operator again replaces the line", async () => {
  const { fake, add } = await setup();
  await add({ control: "N36", line: "mute #a --set 1" });
  const r = (await add({ control: "n36", line: "mute #b --set 1" }))!;
  assert.match(r.message!, /^map 1: N36 press .*\(replaced\)/);
  assert.equal(fake.midiBindings.length, 1);
  assert.equal(fake.midiBindings[0]!.line, "mute #b --set 1");
  await add({ control: "N36", operator: "release", line: "mute #b --set 0" });
  assert.equal(fake.midiBindings.length, 2);
});

test("parse errors answer exit 2 and change nothing", async () => {
  const { fake, add } = await setup();
  for (const args of [
    { control: "CC999", line: "mute #a" },
    { control: "banana", line: "mute #a" },
    { control: "CC1", operator: "press", line: "mute #a --set {}" },
    { control: "CC1", line: "nosuchcommand x" },
    { line: "mute #a" },
    { control: "CC1" },
  ]) {
    const r = (await add(args))!;
    assert.equal(r.code, ExitCode.USAGE, JSON.stringify(args));
  }
  assert.equal(fake.midiBindings.length, 0);
  assert.equal(fake.fileStore.has("set1.json"), false);
  assert.match(((await add({ line: "mute #a" }))!).message!, /missing argument <control>/);
  assert.match(((await add({ control: "CC1" }))!).message!, /missing argument <line>/);
  assert.match(((await add({ control: "CC1", operator: "press", line: "mute #a --set {}" }))!).message!, /press gives no value/);
});

test("-l lists numbered rows, --rm removes one, an unknown number is exit 3", async () => {
  const { fake, add } = await setup();
  assert.match(((await add({}, { list: true }))!).message!, /no bindings/);
  await add({ control: "CC37", line: "mute #a --set 0" });
  await add({ control: "N36", operator: "hold", line: "mute #b --set {}" });
  assert.equal(((await add({}, { list: true }))!).message, "1  CC37  press  | mute #a --set 0\n2  N36  hold  | mute #b --set {}");
  assert.equal(((await add({}, { rm: "3" }))!).code, ExitCode.NOT_FOUND);
  assert.equal(((await add({}, { rm: "x" }))!).code, ExitCode.USAGE);
  const r = (await add({}, { rm: "1" }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(fake.midiBindings.length, 1);
  assert.equal(fake.midiBindings[0]!.control.number, 36);
  assert.equal(parseBindings(fake.fileStore.get("set1.json")!).bindings.length, 1);
});

test("--on and --off set map.enabled; modes do not combine with a control", async () => {
  const { fake, add } = await setup();
  await add({}, { off: true });
  assert.equal(fake.mapEnabled, false);
  assert.match(((await add({}, { list: true }))!).message!, /map is off/);
  await add({}, { on: true });
  assert.equal(fake.mapEnabled, true);
  assert.equal(((await add({}, { on: true, off: true }))!).code, ExitCode.USAGE);
  assert.equal(((await add({ control: "CC1", line: "mute #a" }, { list: true }))!).code, ExitCode.USAGE);
});

test("the Set's saved bindings are loaded and given to the script on sync", async () => {
  const text = serializeBindings([{ control: { kind: "cc", number: 7 }, operator: "press", line: "mute #a --set 1" }]);
  const { fake, add } = await setup({ files: { "set1.json": text } });
  assert.equal(fake.midiBindings.length, 1);
  assert.match(((await add({}, { list: true }))!).message!, /^1  CC7  press/);
});

test("learn binds the newest control that moved and ends the monitor window", async () => {
  const { fake, learn } = await setup({ dialogAnswer: "go", midiMessages: [msg(1, "cc", 1, 20, 5), msg(2, "cc", 2, 51, 10)] });
  const r = (await learn("toggle", "mute #fx --set {}"))!;
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.message!, /^map 1: CC51\/ch2 toggle/);
  assert.equal(fake.midiBindings[0]!.control.channel, 2);
  assert.equal(fake.midiListens[0]!.monitor, true);
  assert.equal(fake.midiListens.at(-1)!.controls, "none");
});

test("learn: Esc changes nothing; nothing moved is exit 1; {} with press is exit 2 before the page opens", async () => {
  const esc = await setup({ midiMessages: [msg(1, "cc", 1, 20, 5)] });
  assert.equal((await esc.learn(undefined, "mute #fx --set 1"))!.message, undefined);
  assert.equal(esc.fake.midiBindings.length, 0);
  const none = await setup({ dialogAnswer: "go" });
  assert.equal((await none.learn(undefined, "mute #fx --set 1"))!.code, ExitCode.FAILURE);
  const bad = await setup({ dialogAnswer: "go" });
  assert.equal((await bad.learn("press", "mute #fx --set {}"))!.code, ExitCode.USAGE);
  assert.equal(bad.fake.livePages.length, 0);
});

test("store: bad rows are dropped, bad JSON gives none", () => {
  assert.deepEqual(parseBindings("nope"), { bindings: [], dropped: 0, damaged: true });
  assert.equal(parseBindings(null).damaged, false);
  const r = parseBindings(JSON.stringify({ bindings: [{ control: "CC1", operator: "press", line: "a" }, { control: "zz", operator: "press", line: "a" }, { control: "CC2", operator: "bogus", line: "a" }] }));
  assert.equal(r.bindings.length, 1);
  assert.equal(r.dropped, 2);
});

test("a Set change loads that Set's bindings", async () => {
  const text = serializeBindings([{ control: { kind: "cc", number: 7 }, operator: "press", line: "mute #a --set 1" }]);
  const fake = createFakeApi({ setId: "set1", files: { "set1.json": text } });
  fake.api.commands.add({ name: "mute", summary: "mute", run: () => undefined });
  registerMap(fake.api, TEMPLATE);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fake.midiBindings.length, 1);
  assert.equal(fake.setListeners.length, 1);
});

test("a file that cannot be read is never overwritten", async () => {
  for (const bad of ["{ nope", JSON.stringify({ rows: [] })]) {
    const { fake, add } = await setup({ files: { "set1.json": bad } });
    const r = (await add({ control: "CC1", line: "mute #a" }))!;
    assert.equal(r.code, ExitCode.FAILURE);
    assert.match(r.message!, /set1\.json cannot be read/);
    assert.equal(fake.fileStore.get("set1.json"), bad);
    assert.ok(fake.logged.some((l) => l.level === "warn" && /set1\.json/.test(l.text)));
  }
});

test("after a damaged file is fixed, the next command loads it and works", async () => {
  const { fake, add } = await setup({ files: { "set1.json": "{ nope" } });
  assert.equal(((await add({ control: "CC1", line: "mute #a" }))!).code, ExitCode.FAILURE);
  fake.fileStore.set("set1.json", serializeBindings([{ control: { kind: "cc", number: 7 }, operator: "press", line: "mute #z --set 1" }]));
  const r = (await add({ control: "CC1", line: "mute #a" }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(fake.midiBindings.map((b) => b.line), ["mute #z --set 1", "mute #a"]);
});

test("a file that fails to read (not missing) is never overwritten either", async () => {
  const fake = createFakeApi({ setId: "set1", files: { "set1.json": serializeBindings([{ control: { kind: "cc", number: 7 }, operator: "press", line: "mute #z --set 1" }]) } });
  fake.unreadableFiles.add("set1.json");
  fake.api.commands.add({ name: "mute", summary: "mute", run: () => undefined });
  registerMap(fake.api, TEMPLATE);
  const leaf = fake.commands.find((c) => c.name === "map")!.children!.find((c) => c.name === "add")!;
  const r = (await leaf.run!({ path: ["map"], options: {}, args: [["CC1"], [], ["mute #a"]] } as never, undefined as never)) as Result;
  assert.equal(r!.code, ExitCode.FAILURE);
  assert.match(r!.message!, /cannot be read/);
  assert.ok(fake.logged.some((l) => /EACCES/.test(l.text)));
});

test("a map error shows the add form, not the group's usage", async () => {
  const { add } = await setup();
  const r = (await add({ control: "CC1" }))!;
  assert.match(r.message!, /usage: map <control> \[press\|release\|hold\|toggle\] \| <command line>/);
  assert.match(r.message!, /map learn/);
  assert.match(r.message!, /map --rm <n>/);
});

test("every form in the usage text parses against the declared tree", async () => {
  const { parse } = await import("../../core/command/parse.js");
  const { fake } = await setup();
  for (const line of ["map CC37 press | mute #a", "map CC37 | mute #a", "map learn press | mute #a", "map -l", "map --rm 2", "map --on", "map --off"]) {
    const outcome = parse(line, fake.commands as never);
    assert.equal(outcome.kind, "run", `${line}: ${outcome.kind === "error" ? outcome.result.message : outcome.kind}`);
  }
});

test("a control Live keeps for itself: add warns (and stores), map -l marks the row, a rebuild report is logged", async () => {
  const { fake, add } = await setup();
  fake.midiBlocked = ["CC51/ch1"];
  const r = (await add({ control: "CC51", line: "mute #a --set 1" }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.message!, /⚠ CC51 is taken in Live \(a Cmd\+M mapping or another control surface\), so cmdAbl doesn't receive it/);
  assert.equal(fake.midiBindings.length, 1);
  await add({ control: "CC7", line: "mute #b --set 1" });
  const rows = ((await add({}, { list: true }))!).message!.split("\n");
  assert.match(rows[0]!, /⚠ taken in Live$/);
  assert.doesNotMatch(rows[1]!, /⚠/);
});

test("a free control gets no warning; a report that arrives after the bind still warns", async () => {
  const { fake, add } = await setup();
  assert.doesNotMatch(((await add({ control: "CC7", line: "mute #a --set 1" }))!).message!, /⚠/);
  const pending = add({ control: "CC8", line: "mute #a --set 1" });
  await new Promise((r) => setTimeout(r, 20));
  fake.midiBlocked = ["CC8/ch2"];
  for (const l of fake.blockedListeners) l(fake.midiBlocked);
  assert.match(((await pending)!).message!, /⚠ CC8 is taken in Live/);
});

test("a rebuild that newly blocks a bound control logs one warning", async () => {
  const { fake, add } = await setup();
  await add({ control: "CC51", line: "mute #a --set 1" });
  fake.midiBlocked = ["CC51/ch1"];
  for (const l of fake.blockedListeners) l(fake.midiBlocked);
  for (const l of fake.blockedListeners) l(fake.midiBlocked);
  assert.equal(fake.logged.filter((l) => l.level === "warn" && /CC51 taken in Live/.test(l.text)).length, 1);
});

test("map learn opens a live page in learn mode; its route shows what moved since the open", async () => {
  const { fake, learn } = await setup({ dialogAnswer: "go", midiMessages: [msg(1, "cc", 1, 48, 64)] });
  await learn(undefined, "mute #fx --set 1");
  const page = fake.livePages[0]!;
  assert.equal(page.name, "map-learn");
  assert.match(page.html, /"mode":"learn"/);
  const answer = (await (page.routes.messages as { wait: (s: number | null, c: never) => Promise<unknown> }).wait(null, { cancelled: false, onCancel() {} } as never)) as { messages: Array<{ number: number }> };
  assert.equal(answer.messages[0]!.number, 48);
  assert.equal(fake.midiBindings[0]!.control.number, 48);
});

test("-l shows what a bare command word with a default expands to", async () => {
  const { add } = await setup({ defaults: { mute: "mute #drums" } });
  await add({ control: "CC1", line: "mute" });
  await add({ control: "CC2", line: "mute #a" });
  await add({ control: "CC3", line: "solo" });
  assert.equal(
    ((await add({}, { list: true }))!).message,
    "1  CC1  press  | mute → mute #drums\n2  CC2  press  | mute #a\n3  CC3  press  | solo",
  );
  const b = { control: { type: "cc", channel: null, number: 4 }, operator: "press", line: "\\mute" } as never;
  assert.match(bindingRow(1, b, false, { mute: "mute #drums" }), /\| \\mute$/);
});
