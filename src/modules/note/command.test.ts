import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../shared/testPorts.js";
import { registerNote } from "./command.js";
import { NO_POSITION_HINT } from "./stamp.js";

const ans = (text: string | null, then: "stamp" | "view" | null = null): string => JSON.stringify({ text, then });
const TEMPLATE = "<script>const NOTE = /*NOTE_PLACEHOLDER*/null;</script>";
type Result = { code: number; message?: string; log?: string[] } | undefined;

/** A runnable node of the note tree by its words: leaf(fake, "stamp", "loop"); no words = the `open` fallback. */
function leaf(fake: { commands: Array<{ name: string; children?: unknown[] }> }, ...words: string[]) {
  let node = fake.commands.find((c) => c.name === "note") as { name: string; children?: unknown[]; run?: unknown };
  for (const w of words.length === 0 ? ["open"] : words) node = (node.children as typeof node[]).find((c) => c.name === w)!;
  return node as unknown as { run: (inv: never, ports: never) => Promise<Result>; fallback?: boolean; bare?: boolean };
}
const inv = (path: string[], options: Record<string, string | true> = {}) => ({ path, options, args: [] }) as never;

function setup(options: Parameters<typeof createFakeApi>[0] = {}) {
  const fake = createFakeApi(options);
  registerNote(fake.api, TEMPLATE);
  const run = (opts: Record<string, string | true> = {}) =>
    leaf(fake).run(inv(["note"], opts), undefined as never);
  /** What the page was given. */
  const given = () => JSON.parse(/const NOTE = (.*);<\/script>/.exec(fake.livePages.at(-1)!.html)![1]!);
  return { fake, run, given };
}

test("a Set with a note opens it in view; -e opens it in edit; the text comes from <id>.md", async () => {
  const { run, given } = setup({ setId: "abc", files: { "abc.md": "# Mix\n- [ ] bass" } });
  assert.equal(await run(), undefined);
  assert.deepEqual(given(), { text: "# Mix\n- [ ] bass", mode: "view", changed: false });
  await run({ edit: true });
  assert.equal(given().mode, "edit");
});

test("a Set without an id, or with an empty note, opens in edit on an empty text and gets no id by looking", async () => {
  const none = setup();
  assert.equal(await none.run(), undefined);
  assert.deepEqual(none.given(), { text: "", mode: "edit", changed: false });
  assert.equal(none.fake.setId, null);
  assert.equal(none.fake.fileStore.size, 0);
  const empty = setup({ setId: "abc", files: { "abc.md": "  \n" } });
  await empty.run();
  assert.equal(empty.given().mode, "edit");
});

test("changed text is written, quietly, with one log line; the id is created only now", async () => {
  const { run, fake } = setup({ dialogAnswer: ans("# Hello\nworld") });
  const r = (await run())!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, undefined);
  assert.equal(fake.setId, "fake-set-id");
  assert.equal(fake.fileStore.get("fake-set-id.md"), "# Hello\nworld");
  assert.equal(r.log!.length, 1);
  assert.doesNotMatch(r.log![0]!, /Hello/); // the note itself is not logged
});

test("an existing id is used as it is and the file is replaced", async () => {
  const { run, fake } = setup({ setId: "abc", files: { "abc.md": "old" }, dialogAnswer: ans("new") });
  await run({ edit: true });
  assert.equal(fake.fileStore.get("abc.md"), "new");
  assert.equal(fake.setId, "abc");
});

test("unchanged or dismissed (empty answer) writes nothing and creates no id", async () => {
  const { run, fake } = setup({ dialogAnswer: ans(null) });
  assert.equal(await run(), undefined);
  assert.equal(fake.setId, null);
  assert.equal(fake.fileStore.size, 0);
});

test("a cleared note (the page sends a newline) writes an empty note", async () => {
  const { run, fake } = setup({ setId: "abc", files: { "abc.md": "text" }, dialogAnswer: ans("") });
  assert.equal(((await run())!).code, ExitCode.OK);
  assert.equal(fake.fileStore.get("abc.md"), "");
});

test("a failed write is exit 1; the text is kept in memory, not in the log, and the next note opens with it", async () => {
  const { run, fake, given } = setup({ setId: "abc", dialogAnswer: ans("precious\ntext") });
  const write = fake.api.files.write;
  fake.api.files.write = async () => false;
  const r = (await run())!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.match(r.message ?? "", /not saved.*Run note again: your text is kept until cmdAbl restarts/);
  assert.doesNotMatch(r.log!.join("\n"), /precious|text$/m);
  assert.match(r.log![0]!, /13 characters/);
  // The next note starts from the kept text, in edit; a successful save clears it.
  fake.api.files.write = write;
  await run();
  assert.deepEqual(given(), { text: "precious\ntext", mode: "edit", changed: true });
  assert.equal(fake.fileStore.get("abc.md"), "precious\ntext");
  await run();
  assert.deepEqual(given(), { text: "precious\ntext", mode: "view", changed: false }); // nothing pending any more
});

test("no id possible (create fails) is exit 1, nothing is written, the text is kept and not logged", async () => {
  const { run, fake, given } = setup({ dialogAnswer: ans("typed") });
  const setId = fake.api.set.id;
  fake.api.set.id = async () => null;
  const r = (await run())!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.match(r.message ?? "", /given an id/);
  assert.doesNotMatch(r.log!.join("\n"), /typed/);
  assert.equal(fake.fileStore.size, 0);
  fake.api.set.id = setId;
  await run();
  assert.equal(given().text, "typed");
});

test("the id could not be read first but the Set has a note: it is not overwritten", async () => {
  const { run, fake, given } = setup({ setId: "abc", files: { "abc.md": "the real note" }, dialogAnswer: ans("typed over it") });
  const setId = fake.api.set.id;
  let calls = 0;
  fake.api.set.id = async (create) => (calls++ === 0 ? null : setId(create)); // the first read fails, create finds the existing id
  const r = (await run())!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.match(r.message ?? "", /already has a note that could not be read before/);
  assert.equal(fake.fileStore.get("abc.md"), "the real note");
  // The next note shows the real note with the unsaved text after it.
  fake.api.set.id = setId;
  await run();
  assert.deepEqual(given(), { text: "the real note\n\ntyped over it", mode: "edit", changed: true });
});

test("the file could not be read first but exists: it is not overwritten", async () => {
  const { run, fake } = setup({ setId: "abc", files: { "abc.md": "the real note" }, dialogAnswer: ans("typed over it") });
  const read = fake.api.files.read;
  let calls = 0;
  fake.api.files.read = async (name) => (calls++ === 0 ? null : read(name));
  const r = (await run())!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.equal(fake.fileStore.get("abc.md"), "the real note");
});

test("a note that is really missing (or an empty one) is written after the second look", async () => {
  const { run, fake } = setup({ setId: "abc", dialogAnswer: ans("first note") });
  assert.equal(((await run())!).code, ExitCode.OK);
  assert.equal(fake.fileStore.get("abc.md"), "first note");
});

test("the note tree: open and add are bare fallbacks, every leaf needs the Remote Script (exit 5 from the platform), no top-level stamp", () => {
  const { fake } = setup();
  const note = fake.commands[0]!;
  assert.equal(note.name, "note");
  assert.equal(note.topic, "Look things up");
  assert.equal(fake.commands.length, 1, "no top-level stamp");
  const open = leaf(fake) as never as { requires: string[]; options: Array<{ name: string; short?: string }>; fallback: boolean; bare: boolean };
  assert.deepEqual(open.requires, ["bridge"]);
  assert.deepEqual(open.options.map((o) => [o.name, o.short]), [["edit", "e"]]);
  assert.deepEqual([open.fallback, open.bare], [true, true]);
  const add = leaf(fake, "stamp", "add") as never as { requires: string[]; fallback: boolean; bare: boolean };
  assert.deepEqual([add.requires, add.fallback, add.bare], [["bridge"], true, true]);
  const stamp = (fake.commands[0]!.children as Array<{ name: string; children?: unknown[] }>).find((c) => c.name === "stamp")!;
  assert.deepEqual((stamp.children as Array<{ name: string }>).map((c) => c.name), ["add", "list", "next", "prev"], "the loop lines moved to the loop module");
});

test("a note text with </script> or a placeholder-like text reaches the page escaped, once", async () => {
  const text = "</script><b>/*NOTE_PLACEHOLDER*/null";
  const { run, given, fake } = setup({ setId: "abc", files: { "abc.md": text } });
  await run();
  assert.equal(given().text, text);
  assert.doesNotMatch(fake.livePages[0]!.html.replace(TEMPLATE.slice(-9), ""), /<\/script><b>/);
});

test("the retry after a failed save: the page answers the kept text unchanged (it was told changed: true) and it is written", async () => {
  const { run, fake, given } = setup({ setId: "abc", dialogAnswer: ans("kept text") });
  const write = fake.api.files.write;
  fake.api.files.write = async () => false;
  assert.equal(((await run())!).code, ExitCode.FAILURE);
  fake.api.files.write = write;
  await run();
  assert.equal(given().changed, true); // the page must send the text on Save although it was not edited
  assert.equal(fake.fileStore.get("abc.md"), "kept text");
  await run();
  assert.equal(given().changed, false);
});

// --- stamps ---------------------------------------------------------------------------------------------

const PLAYING = { playing: true, session: false, pos: "12.3.1.1", time: 44, barStart: 44, barLen: 4, sigNum: 4, sigDen: 4, songLength: 200, loop: { on: false, start: 0, length: 16 } };
const FIXED = new Date(2026, 10, 11, 14, 5);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function stampSetup(options: Parameters<typeof createFakeApi>[0] = {}, answers: Array<string | null> = [ans("")]) {
  const fake = createFakeApi(options);
  registerNote(fake.api, TEMPLATE, () => FIXED);
  const given: Array<Record<string, unknown>> = [];
  fake.api.ui.livePage = (async (_n: string, html: string) => {
    given.push(JSON.parse(/const NOTE = (.*);<\/script>/.exec(html)![1]!));
    return answers.shift() ?? null;
  }) as never;
  const run = (opts: Record<string, string | true> = {}) => {
    return opts.stamp === true
      ? leaf(fake, "stamp", "add").run(inv(["note", "stamp"]), undefined as never)
      : leaf(fake).run(inv(["note"]), undefined as never);
  };
  return { fake, run, given };
}

test("stamp while playing: stamp page with the heading, and the note never touches the loop", async () => {
  const { fake, run, given } = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("### x\ntext")]);
  const r = (await run({ stamp: true }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(given[0]!.mode, "stamp");
  assert.deepEqual(given[0]!.stamp, { heading: "### @12.3.1 · 2026-11-11 14:05" });
  assert.deepEqual(fake.transport!.loop, PLAYING.loop);
  assert.equal(fake.fileStore.get("abc.md"), "### x\ntext");
});

test("the hint appears without a script", async () => {
  const none = stampSetup({ setId: "abc" });
  await none.run({ stamp: true });
  assert.equal((none.given[0]!.stamp as { hint?: string }).hint, NO_POSITION_HINT);
});

test("the page answer then: stamp saves the text, then opens the stamp page", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("one", "stamp"), ans("one\ntwo")]);
  const r = (await s.run())!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(s.given.map((g) => g.mode), ["edit", "stamp"]);
  assert.equal(s.fake.fileStore.get("abc.md"), "one\ntwo");
});

test("Esc in stamp edit (then: view) saves and reopens the note in view; s there starts the next stamp", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("### x", "view"), ans(null, "stamp"), ans(null)]);
  const r = (await s.run({ stamp: true }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(s.given.map((g) => g.mode), ["stamp", "view", "stamp"]);
});

test("a failed save in the loop stops it with exit 1", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING), unreadableFiles: ["abc.md"] } as never, [ans("x", "stamp")]);
  s.fake.api.files.write = async () => false;
  const r = (await s.run({ stamp: true }))!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.equal(s.given.length, 1);
});

test("an unreadable page answer writes nothing but leaves a log line", async () => {
  const s = stampSetup({ setId: "abc" }, ["plain text"]);
  const r = await s.run({ stamp: true });
  assert.ok(s.fake.logged.some((l) => l.level === "warn" && /unreadable/.test(l.text)));
  assert.equal(s.fake.fileStore.has("abc.md"), false);
  void r;
});

test("note declares its settings, note.stampLoop (the length is loop.bars) and note.stampWrap", () => {
  const { fake } = setup();
  const items = fake.settingGroups.flatMap((g) => g.items).map((i) => [i.key, i.kind, i.default]);
  assert.deepEqual(items, [["note.stampLoop", "bool", true], ["note.stampWrap", "bool", false]]);
});

test("the note page is a live page: runs loop here/back, closes with loop back, and the heading says whether to loop", async () => {
  const fake = createFakeApi({ setId: "abc", transport: clone(PLAYING), dialogAnswer: ans(null) });
  registerNote(fake.api, TEMPLATE, () => FIXED);
  await leaf(fake).run(inv(["note"]), undefined as never);
  const page = fake.livePages[0]!;
  assert.deepEqual(page.run, ["loop here", "loop back", "jump"]);
  assert.equal(page.onClose, "loop back");
  const heading = page.routes.heading as (q: never) => Promise<unknown>;
  assert.deepEqual(await heading({} as never), { heading: "### @12.3.1 · 2026-11-11 14:05", loop: true });
  fake.transport!.playing = false;
  assert.deepEqual(await heading({} as never), { heading: "### 2026-11-11 14:05", loop: false });
  fake.transport!.playing = true;
  fake.transport!.session = true;
  assert.equal(((await heading({} as never)) as { loop: boolean }).loop, false);
  fake.transport!.session = false;
  fake.settingValues["note.stampLoop"] = false;
  assert.equal(((await heading({} as never)) as { loop: boolean }).loop, false);
  fake.transport = null;
  fake.settingValues["note.stampLoop"] = true;
  assert.deepEqual(await heading({} as never), { heading: "### 2026-11-11 14:05", hint: NO_POSITION_HINT, loop: false });
});

test("the note module registers through the real registry: a valid tree, documented, and the lines parse to the right leaf", async () => {
  const { assertDocumented, declaredBy } = await import("../shared/docs.testkit.js");
  const { validateTree } = await import("../../core/command/commandTree.js");
  const { parse } = await import("../../core/command/parse.js");
  const activate = (api: Parameters<typeof registerNote>[0]): void => registerNote(api, TEMPLATE);
  const roots = declaredBy(activate);
  assert.deepEqual(validateTree(roots as never), []);
  assertDocumented(roots, ["note open", "note stamp add", "note stamp list", "note stamp next", "note stamp prev"]);
  const ran = (line: string) => {
    const o = parse(line, roots);
    return o.kind === "run" ? [o.invocation.path.join(" "), o.invocation.options] : o.kind;
  };
  assert.deepEqual(ran("note"), ["note", {}]);
  assert.deepEqual(ran("note -e"), ["note", { edit: true }]);
  assert.deepEqual(ran("note stamp"), ["note stamp", {}]);
  assert.equal(parse("stamp", roots).kind, "error"); // the old top-level spelling is gone
  assert.equal(parse("note stamp loop", roots).kind, "error"); // moved to the loop module
});

// --- reading stamps back (plan 0027) ----------------------------------------------------------------------
const STAMPED = [
  "### @4.1.1 · 2026-11-11 15:00",
  "kick too loud",
  "### 2026-11-10 09:00",
  "idea while stopped",
  "### @12.3.1 · 2026-11-11 14:32",
  "snare",
  "### @20.2.3 · 2026-11-12 08:00",
].join("\n");
const AT_BAR = (pos: string, over: object = {}) => ({ playing: true, session: false, pos, time: 0, barStart: 0, barLen: 4, sigNum: 4, sigDen: 4, songLength: 200, loop: { on: false, start: 0, length: 16 }, ...over });

function readSetup(pos: string, settings: Record<string, unknown> = {}, extra: Parameters<typeof createFakeApi>[0] = {}) {
  const fake = createFakeApi({ setId: "abc", files: { "abc.md": STAMPED }, transport: AT_BAR(pos) as never, settings, ...extra } as never);
  registerNote(fake.api, TEMPLATE);
  const go = (word: string) => leaf(fake, "stamp", word).run(inv(["note", "stamp", word]), undefined as never) as Promise<Result>;
  return { fake, go };
}

test("stamp next / prev jump by position from the playhead", async () => {
  const s = readSetup("5.1.1.1");
  assert.equal((await s.go("next"))!.code, ExitCode.OK);
  assert.equal((await s.go("prev"))!.code, ExitCode.OK);
  assert.deepEqual(s.fake.jumps, [44 + 2, 12]); // 12.3.1 in 4/4 = 11*4+2; 4.1.1 = 12
});

test("stamp next uses the signature: 6/8", async () => {
  const s = readSetup("5.1.1.1", {}, { transport: AT_BAR("5.1.1.1", { sigNum: 6, sigDen: 8 }) as never });
  await s.go("next");
  assert.deepEqual(s.fake.jumps, [11 * 3 + 2 * 0.5]);
});

test("at the ends: exit 3 with the bar; with note.stampWrap it wraps", async () => {
  const end = readSetup("21.1.1.1");
  const r = (await end.go("next"))!;
  assert.equal(r.code, ExitCode.NOT_FOUND);
  assert.match(r.message ?? "", /no stamp after bar 21/);
  assert.match(((await readSetup("1.1.1.1").go("prev"))!).message ?? "", /no stamp before bar 1/);
  const wrap = readSetup("21.1.1.1", { "note.stampWrap": true });
  assert.equal((await wrap.go("next"))!.code, ExitCode.OK);
  assert.deepEqual(wrap.fake.jumps, [12]);
  assert.equal((await readSetup("1.1.1.1", { "note.stampWrap": true }).go("prev"))!.code, ExitCode.OK);
});

test("no note, no stamps, no script, an old script, Live's refusal", async () => {
  assert.equal((await readSetup("5.1.1.1", {}, { files: {} }).go("next"))!.code, ExitCode.NOT_FOUND);
  assert.equal((await readSetup("5.1.1.1", {}, { transport: null }).go("next"))!.code, ExitCode.UNAVAILABLE);
  assert.equal((await readSetup("5.1.1.1", {}, { transport: AT_BAR("5.1.1.1", { sigNum: 0, sigDen: 0 }) as never }).go("next"))!.code, ExitCode.UNAVAILABLE);
  const refused = readSetup("5.1.1.1", {}, { jumpFails: { code: 1, text: "Live refused the jump" } });
  assert.equal((await refused.go("next"))!.code, ExitCode.FAILURE);
});

test("stamp list: rows with the date-only one disabled, the cursor on the next stamp, Enter jumps", async () => {
  const s = readSetup("5.1.1.1", {}, { pickRowsAnswer: (_rows: unknown, cursor: number | undefined) => cursor ?? null } as never);
  const r = (await s.go("list"))!;
  assert.equal(r.code, ExitCode.OK);
  const list = s.fake.rowLists[0]!;
  assert.deepEqual(list.rows.map((x) => !!x.disabled), [false, true, false, false]);
  assert.equal(list.rows[0]!.label, "@4.1.1 · 2026-11-11 15:00");
  assert.equal(list.rows[0]!.detail, "kick too loud");
  assert.equal(list.cursor, 2); // 12.3.1 is the next stamp after bar 5
  assert.deepEqual(s.fake.jumps, [46]);
});

test("stamps behind the song end: next says why, list marks them disabled", async () => {
  const short = { transport: AT_BAR("5.1.1.1", { songLength: 40 }) as never };
  const s = readSetup("5.1.1.1", {}, short);
  const r = (await s.go("next"))!; // 12.3.1 (beat 46) and 20.2.3 are behind 40: not reachable
  assert.equal(r.code, ExitCode.NOT_FOUND);
  assert.match(r.message ?? "", /no stamp after bar 5 \(2 too far for Live\)/);
  assert.deepEqual(s.fake.jumps, []);
  const wrap = readSetup("5.1.1.1", { "note.stampWrap": true }, short);
  assert.equal((await wrap.go("next"))!.code, ExitCode.OK);
  assert.deepEqual(wrap.fake.jumps, [12]); // wraps to the first reachable stamp, 4.1.1
  const l = readSetup("5.1.1.1", {}, short);
  await l.go("list");
  const rows = l.fake.rowLists[0]!.rows;
  assert.deepEqual(rows.map((x) => x.detail), ["kick too loud", "no song position", "too far for Live", "too far for Live"]);
  assert.deepEqual(rows.map((x) => !!x.disabled), [false, true, true, true]);
});

test("stamp list cancelled or on a disabled row jumps nowhere", async () => {
  const s = readSetup("5.1.1.1");
  assert.equal((await s.go("list"))!.code, ExitCode.OK);
  const d = readSetup("5.1.1.1", {}, { pickRowsAnswer: () => 1 } as never);
  await d.go("list");
  assert.deepEqual([...s.fake.jumps, ...d.fake.jumps], []);
});

test("the note page may run jump", async () => {
  const { run, fake } = setup({ setId: "abc", files: { "abc.md": "x" } });
  await run();
  assert.deepEqual(fake.livePages[0]!.run, ["loop here", "loop back", "jump"]);
});

test("stamp list with only date-only stamps is exit 3 and shows no list", async () => {
  const fake = createFakeApi({ setId: "abc", files: { "abc.md": "### 2026-11-10 09:00\nidea" }, transport: AT_BAR("5.1.1.1") as never } as never);
  registerNote(fake.api, TEMPLATE);
  const r = (await leaf(fake, "stamp", "list").run(inv(["note", "stamp", "list"]), undefined as never))!;
  assert.equal(r.code, ExitCode.NOT_FOUND);
  assert.equal(fake.rowLists.length, 0);
});
