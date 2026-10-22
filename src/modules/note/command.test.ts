import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { registerNote } from "./command.js";

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
  const { run, fake } = setup({ dialogAnswer: "# Hello\nworld" });
  const r = (await run())!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, undefined);
  assert.equal(fake.setId, "fake-set-id");
  assert.equal(fake.fileStore.get("fake-set-id.md"), "# Hello\nworld");
  assert.equal(r.log!.length, 1);
  assert.doesNotMatch(r.log![0]!, /Hello/); // the note itself is not logged
});

test("an existing id is used as it is and the file is replaced", async () => {
  const { run, fake } = setup({ setId: "abc", files: { "abc.md": "old" }, dialogAnswer: "new" });
  await run({ edit: true });
  assert.equal(fake.fileStore.get("abc.md"), "new");
  assert.equal(fake.setId, "abc");
});

test("unchanged or dismissed (empty answer) writes nothing and creates no id", async () => {
  const { run, fake } = setup({ dialogAnswer: "" });
  assert.equal(await run(), undefined);
  assert.equal(fake.setId, null);
  assert.equal(fake.fileStore.size, 0);
});

test("a cleared note (the page sends a newline) writes an empty note", async () => {
  const { run, fake } = setup({ setId: "abc", files: { "abc.md": "text" }, dialogAnswer: "\n" });
  assert.equal(((await run())!).code, ExitCode.OK);
  assert.equal(fake.fileStore.get("abc.md"), "");
});

test("a failed write is exit 1; the text is kept in memory, not in the log, and the next note opens with it", async () => {
  const { run, fake, given } = setup({ setId: "abc", dialogAnswer: "precious\ntext" });
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
  const { run, fake, given } = setup({ dialogAnswer: "typed" });
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
  const { run, fake, given } = setup({ setId: "abc", files: { "abc.md": "the real note" }, dialogAnswer: "typed over it" });
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
  const { run, fake } = setup({ setId: "abc", files: { "abc.md": "the real note" }, dialogAnswer: "typed over it" });
  const read = fake.api.files.read;
  let calls = 0;
  fake.api.files.read = async (name) => (calls++ === 0 ? null : read(name));
  const r = (await run())!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.equal(fake.fileStore.get("abc.md"), "the real note");
});

test("a note that is really missing (or an empty one) is written after the second look", async () => {
  const { run, fake } = setup({ setId: "abc", dialogAnswer: "first note" });
  assert.equal(((await run())!).code, ExitCode.OK);
  assert.equal(fake.fileStore.get("abc.md"), "first note");
});

test("the command needs the Remote Script (exit 5 comes from the platform) and sits in Look things up", () => {
  const { fake } = setup();
  const note = fake.commands[0]!;
  assert.deepEqual(note.requires, ["bridge"]);
  assert.equal(note.topic, "Look things up");
  assert.deepEqual((note.options ?? []).map((o) => [o.name, o.short]), [["edit", "e"]]);
});

test("a note text with </script> or a placeholder-like text reaches the page escaped, once", async () => {
  const text = "</script><b>/*NOTE_PLACEHOLDER*/null";
  const { run, given, fake } = setup({ setId: "abc", files: { "abc.md": text } });
  await run();
  assert.equal(given().text, text);
  assert.doesNotMatch(fake.dialogs[0]!.html.replace(TEMPLATE.slice(-9), ""), /<\/script><b>/);
});

test("the retry after a failed save: the page answers the kept text unchanged (it was told changed: true) and it is written", async () => {
  const { run, fake, given } = setup({ setId: "abc", dialogAnswer: "kept text" });
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
