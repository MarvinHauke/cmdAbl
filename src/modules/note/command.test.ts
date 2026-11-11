import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../shared/testPorts.js";
import { registerNote } from "./command.js";

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
  for (const w of ["loop", "unloop"]) assert.deepEqual((leaf(fake, "stamp", w) as never as { requires: string[] }).requires, ["bridge"]);
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

const PLAYING = { playing: true, session: false, pos: "12.3.1.1", time: 44, barStart: 44, barLen: 4, loop: { on: false, start: 0, length: 16 } };
const FIXED = new Date(2026, 10, 11, 14, 5);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function stampSetup(options: Parameters<typeof createFakeApi>[0] = {}, answers: Array<string | null> = [ans("")]) {
  const fake = createFakeApi(options);
  registerNote(fake.api, TEMPLATE, () => FIXED);
  const given: Array<Record<string, unknown>> = [];
  const loops: Array<{ on: boolean; start: number; length: number }> = [];
  const setLoop = fake.api.set.setLoop;
  fake.api.set.setLoop = async (l) => (loops.push(l), setLoop(l));
  fake.api.ui.livePage = (async (_n: string, html: string) => {
    given.push(JSON.parse(/const NOTE = (.*);<\/script>/.exec(html)![1]!));
    // Where the loop is while the page is open.
    given.at(-1)!.loopWhileOpen = fake.transport?.loop;
    return answers.shift() ?? null;
  }) as never;
  const run = (opts: Record<string, string | true> = {}) => {
    return opts.stamp === true
      ? leaf(fake, "stamp", "add").run(inv(["note", "stamp"]), undefined as never)
      : leaf(fake).run(inv(["note"]), undefined as never);
  };
  return { fake, run, given, loops };
}

test("stamp while playing: stamp page with the heading, the loop set while open and put back after", async () => {
  const { fake, run, given, loops } = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("### x\ntext")]);
  const r = (await run({ stamp: true }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(given[0]!.mode, "stamp");
  assert.deepEqual(given[0]!.stamp, { heading: "### @12.3.1 · 2026-11-11 14:05" });
  assert.deepEqual(given[0]!.loopWhileOpen, { on: true, start: 44, length: 16 });
  assert.deepEqual(fake.transport!.loop, PLAYING.loop);
  assert.equal(loops.length, 2);
  assert.equal(fake.fileStore.get("abc.md"), "### x\ntext");
});

test("the loop is put back even when the save fails; a moved loop is left alone", async () => {
  const failing = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("t")]);
  failing.fake.api.files.write = async () => false;
  assert.equal(((await failing.run({ stamp: true }))!).code, ExitCode.FAILURE);
  assert.deepEqual(failing.fake.transport!.loop, PLAYING.loop);

  const moved = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("t")]);
  const dialog = moved.fake.api.ui.livePage;
  moved.fake.api.ui.livePage = (async (...a: Parameters<typeof dialog>) => {
    const r = await dialog(...a);
    moved.fake.transport!.loop = { on: true, start: 100, length: 8 }; // the user moved it by hand
    return r;
  }) as never;
  await moved.run({ stamp: true });
  assert.deepEqual(moved.fake.transport!.loop, { on: true, start: 100, length: 8 });
});

test("no loop when stopped, in Session playback, with the setting off, or with no script; the hint appears without a script", async () => {
  for (const t of [{ ...PLAYING, playing: false }, { ...PLAYING, session: true }]) {
    const s = stampSetup({ setId: "abc", transport: clone(t) });
    await s.run({ stamp: true });
    assert.equal(s.loops.length, 0);
  }
  const off = stampSetup({ setId: "abc", transport: clone(PLAYING), settings: { "note.stampLoop": false } });
  await off.run({ stamp: true });
  assert.equal(off.loops.length, 0);
  const none = stampSetup({ setId: "abc" });
  await none.run({ stamp: true });
  assert.deepEqual(none.given[0]!.stamp, { heading: "### 2026-11-11 14:05", hint: "no song position: Remote Script not running" });
  assert.equal(none.loops.length, 0);
});

test("loopBars is used for the length", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING), settings: { "note.loopBars": 8 } });
  await s.run({ stamp: true });
  assert.deepEqual(s.loops[0], { on: true, start: 44, length: 32 });
});

test("the page answer then: stamp saves the text, then opens the stamp page", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("edited", "stamp"), ans("edited\n### s\nmore")]);
  const r = (await s.run())!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(s.given.length, 2);
  assert.equal(s.given[0]!.mode, "edit");
  assert.equal(s.given[1]!.mode, "stamp");
  assert.equal(s.given[1]!.text, "edited"); // the first save is in the note the stamp page starts from
  assert.equal(s.fake.fileStore.get("abc.md"), "edited\n### s\nmore");
});

test("a stamp page that answers nothing writes nothing and still restores the loop", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans(null)]);
  assert.equal(((await s.run({ stamp: true }))!).code, ExitCode.OK);
  assert.equal(s.fake.fileStore.size, 0);
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});

test("note declares its two settings", () => {
  const { fake } = setup();
  const items = fake.settingGroups.flatMap((g) => g.items.map((i) => [i.key, i.kind, i.default]));
  assert.deepEqual(items, [["note.stampLoop", "bool", true], ["note.loopBars", "int", 4]]);
});

test("an unreadable page answer writes nothing but leaves a log line", async () => {
  const { run, fake } = setup({ setId: "abc", dialogAnswer: "not json" });
  assert.equal(await run(), undefined);
  assert.ok(fake.logged.some((l) => l.level === "warn" && /unreadable page answer/.test(l.text)));
  assert.equal(fake.fileStore.size, 0);
});

test("m from view after a failed save: no stamp starts, exit 1, the text stays pending", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("first", "stamp"), ans("never")]);
  s.fake.api.files.write = async () => false;
  const r = (await s.run())!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.equal(s.given.length, 1);
  assert.equal(s.loops.length, 0);
});

test("a failed loop restore is a warn, not an ok line", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans(null)]);
  const setLoop = s.fake.api.set.setLoop;
  let n = 0;
  s.fake.api.set.setLoop = async (l) => (n++ === 0 ? setLoop(l) : null);
  const r = await s.run({ stamp: true });
  assert.doesNotMatch((r?.log ?? []).join("\n"), /put back/);
  assert.ok(s.fake.logged.some((l) => l.level === "warn" && /loop not restored/.test(l.text)));
});

test("Esc in stamp edit (then: view): saved, loop put back, the note reopens in view; m there starts the next stamp", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("### a\none", "view"), ans(null, "stamp"), ans("### a\none\n### b\ntwo")]);
  const r = (await s.run({ stamp: true }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(s.given.map((g) => g.mode), ["stamp", "view", "stamp"]);
  assert.equal(s.given[1]!.loopWhileOpen && (s.given[1]!.loopWhileOpen as { on: boolean }).on, false); // loop is back while viewing
  assert.deepEqual(s.given[2]!.loopWhileOpen, { on: true, start: 44, length: 16 });
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
  assert.equal(s.fake.fileStore.get("abc.md"), "### a\none\n### b\ntwo");
});

test("a stamp page may answer then: stamp (no longer ignored)", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("a", "stamp"), ans("b")]);
  await s.run({ stamp: true });
  assert.deepEqual(s.given.map((g) => g.mode), ["stamp", "stamp"]);
});

test("a failed save in the loop stops it with exit 1 and restores the loop", async () => {
  const s = stampSetup({ setId: "abc", transport: clone(PLAYING) }, [ans("a", "view"), ans("never")]);
  s.fake.api.files.write = async () => false;
  assert.equal(((await s.run({ stamp: true }))!).code, ExitCode.FAILURE);
  assert.equal(s.given.length, 1);
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});

// --- note stamp loop / unloop and the live page -----------------------------------------------------------------

function loopSetup(transport: object | null = PLAYING, settings: Record<string, unknown> = {}) {
  const fake = createFakeApi({ setId: "abc", transport: transport === null ? null : clone(transport as never), settings } as never);
  registerNote(fake.api, TEMPLATE, () => FIXED);
  return {
    fake,
    loop: () => leaf(fake, "stamp", "loop").run(inv(["note", "stamp", "loop"]), undefined as never),
    unloop: () => leaf(fake, "stamp", "unloop").run(inv(["note", "stamp", "unloop"]), undefined as never),
  };
}

test("note stamp loop sets the loop and unloop puts the old one back", async () => {
  const s = loopSetup();
  assert.equal(((await s.loop())!).code, ExitCode.OK);
  assert.deepEqual(s.fake.transport!.loop, { on: true, start: 44, length: 16 });
  assert.equal(((await s.unloop())!).code, ExitCode.OK);
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});

test("a second note stamp loop keeps the first old loop", async () => {
  const s = loopSetup();
  await s.loop();
  await s.loop();
  await s.unloop();
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});

test("unloop leaves a loop the user moved; --unloop without --loop, and loop with nothing to do, are quiet no-ops", async () => {
  const s = loopSetup();
  const r = (await s.unloop())!;
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.log![0]!, /nothing to restore/);
  await s.loop();
  s.fake.transport!.loop = { on: true, start: 100, length: 8 };
  assert.match(((await s.unloop())!).log![0]!, /left alone/);
  assert.deepEqual(s.fake.transport!.loop, { on: true, start: 100, length: 8 });
  assert.match(((await s.unloop())!).log![0]!, /nothing to restore/); // forgotten after that

  for (const t of [{ ...PLAYING, playing: false }, { ...PLAYING, session: true }, null]) {
    const n = loopSetup(t);
    const q = (await n.loop())!;
    assert.equal(q.code, ExitCode.OK);
    assert.match(q.log![0]!, /nothing to do/);
  }
  const off = loopSetup(PLAYING, { "note.stampLoop": false });
  assert.match(((await off.loop())!).log![0]!, /nothing to do/);
  assert.deepEqual(off.fake.transport!.loop, PLAYING.loop);
});

test("the note page is a live page that may run note stamp loop/unloop and serves the heading", async () => {
  const fake = createFakeApi({ setId: "abc", transport: clone(PLAYING), dialogAnswer: ans(null) });
  registerNote(fake.api, TEMPLATE, () => FIXED);
  await leaf(fake).run(inv(["note"]), undefined as never);
  const page = fake.livePages[0]!;
  assert.deepEqual(page.run, ["note stamp loop", "note stamp unloop"]);
  const heading = page.routes.heading as (q: never) => Promise<unknown>;
  assert.deepEqual(await heading({} as never), { heading: "### @12.3.1 · 2026-11-11 14:05" });
});

test("safety net: a loop the page set (note stamp loop) is put back when the page closes", async () => {
  const s = loopSetup();
  const pages = s.fake.api.ui.livePage;
  s.fake.api.ui.livePage = (async (...a: Parameters<typeof pages>) => {
    await s.loop(); // what the page's run does
    return pages(...a);
  }) as never;
  await leaf(s.fake).run(inv(["note"]), undefined as never);
  assert.deepEqual(s.fake.transport!.loop, PLAYING.loop);
});

test("a failing script gives exit 5", async () => {
  const s = loopSetup();
  s.fake.api.set.setLoop = async () => null;
  assert.equal(((await s.loop())!).code, ExitCode.UNAVAILABLE);
});

test("the note module registers through the real registry: a valid tree, documented, and the lines parse to the right leaf", async () => {
  const { assertDocumented, declaredBy } = await import("../shared/docs.testkit.js");
  const { validateTree } = await import("../../core/command/commandTree.js");
  const { parse } = await import("../../core/command/parse.js");
  const activate = (api: Parameters<typeof registerNote>[0]): void => registerNote(api, TEMPLATE);
  const roots = declaredBy(activate);
  assert.deepEqual(validateTree(roots as never), []);
  assertDocumented(roots, ["note open", "note stamp add", "note stamp loop", "note stamp unloop"]);
  const ran = (line: string) => {
    const o = parse(line, roots);
    return o.kind === "run" ? [o.invocation.path.join(" "), o.invocation.options] : o.kind;
  };
  assert.deepEqual(ran("note"), ["note", {}]);
  assert.deepEqual(ran("note -e"), ["note", { edit: true }]);
  assert.deepEqual(ran("note stamp"), ["note stamp", {}]);
  assert.deepEqual(ran("note stamp loop"), ["note stamp loop", {}]);
  assert.deepEqual(ran("note stamp unloop"), ["note stamp unloop", {}]);
  assert.equal(parse("stamp", roots).kind, "error"); // the old top-level spelling is gone
  assert.equal(parse("note stamp --loop", roots).kind, "error");
});
