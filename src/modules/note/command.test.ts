import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../shared/testPorts.js";
import { registerNote } from "./command.js";

const ans = (text: string | null, then: "stamp" | "view" | null = null): string => JSON.stringify({ text, then });
const TEMPLATE = "<script>const NOTE = /*NOTE_PLACEHOLDER*/null;</script>";
type Result = { code: number; message?: string; log?: string[] } | undefined;

function setup(options: Parameters<typeof createFakeApi>[0] = {}) {
  const fake = createFakeApi(options);
  registerNote(fake.api, TEMPLATE);
  const run = (opts: Record<string, string | true> = {}) =>
    fake.commands[0]!.run!({ path: ["note"], options: opts, args: [] } as never, undefined as never) as Promise<Result>;
  /** What the page was given. */
  const given = () => JSON.parse(/const NOTE = (.*);<\/script>/.exec(fake.dialogs.at(-1)!.html)![1]!);
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

test("the command needs the Remote Script (exit 5 comes from the platform) and sits in Look things up", () => {
  const { fake } = setup();
  const note = fake.commands[0]!;
  assert.deepEqual(note.requires, ["bridge"]);
  assert.equal(note.topic, "Look things up");
  assert.deepEqual((note.options ?? []).map((o) => [o.name, o.short]), [["edit", "e"]]);
  const stamp = fake.commands[1]!;
  assert.equal(stamp.name, "stamp");
  assert.deepEqual(stamp.requires, ["bridge"]);
  assert.ok(stamp.summary && (stamp.examples ?? []).length > 0);
});

test("a note text with </script> or a placeholder-like text reaches the page escaped, once", async () => {
  const text = "</script><b>/*NOTE_PLACEHOLDER*/null";
  const { run, given, fake } = setup({ setId: "abc", files: { "abc.md": text } });
  await run();
  assert.equal(given().text, text);
  assert.doesNotMatch(fake.dialogs[0]!.html.replace(TEMPLATE.slice(-9), ""), /<\/script><b>/);
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
  fake.api.dialog = async (html) => {
    given.push(JSON.parse(/const NOTE = (.*);<\/script>/.exec(html)![1]!));
    // Where the loop is while the page is open.
    given.at(-1)!.loopWhileOpen = fake.transport?.loop;
    return answers.shift() ?? null;
  };
  const run = (opts: Record<string, string | true> = {}) => {
    const stamp = opts.stamp === true;
    return fake.commands[stamp ? 1 : 0]!.run!({ path: [stamp ? "stamp" : "note"], options: {}, args: [] } as never, undefined as never) as Promise<Result>;
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
  const dialog = moved.fake.api.dialog;
  moved.fake.api.dialog = async (...a) => {
    const r = await dialog(...a);
    moved.fake.transport!.loop = { on: true, start: 100, length: 8 }; // the user moved it by hand
    return r;
  };
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
