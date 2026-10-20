import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { fail } from "../../ableton/bridgeProtocol.js";
import { createFakeApi } from "../testPorts.js";
import { activate, changeLines } from "./index.js";

const track = (name: string, i: number) =>
  ({ name, path: `/${name}`, kind: "track", scope: "regular", route: [i], handleId: name }) as unknown as ObjectNode;
const lead = track("Lead", 0);
const bass = track("Bass", 1);
const drums = track("Drums", 2);

const logOf = (r: { log?: string[] }) => (r.log ?? []).join("\n");

type Opts = Parameters<typeof createFakeApi>[0];
function setup(tags: Record<string, string[]>, extra: Opts = {}) {
  const fake = createFakeApi({ nodes: [lead, bass, drums], tags, ...extra });
  activate(fake.api);
  const run = (options: Record<string, string | true>, targets: ObjectNode[], names: string[]) =>
    fake.commands[0]!.run!({ path: ["tag"], options, args: [targets, names] } as never, undefined as never) as Promise<
      { code: number; message?: string; log?: string[]; details?: Array<{ ok: boolean; message?: string }> } | undefined
    >;
  return { fake, run };
}

test("toggle adds and removes per name and names the commands that undo it", async () => {
  const { run, fake } = setup({ Lead: ["drum"] });
  const r = (await run({}, [lead], ["fx", "drum"]))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
  assert.equal(r.message, undefined);
  assert.deepEqual(r.log, ["/Lead: +fx -drum (now #fx)", "  undo: tag --set 0 /Lead fx", "  undo: tag --set 1 /Lead drum"]);
});

test("--set 1 and --set 0 say what they do and skip tracks that already match", async () => {
  const { run, fake } = setup({ Lead: ["fx"] });
  const r = (await run({ set: "1" }, [lead, bass], ["fx"]))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(fake.tagStore.get("Bass"), ["fx"]);
  assert.equal(r.message, undefined);
  assert.match(logOf(r), /^\/Lead: no change \(#fx\)\n\/Bass: \+fx/);
  const off = (await run({ set: "0" }, [lead, bass], ["fx"]))!;
  assert.equal(off.code, ExitCode.OK);
  assert.equal(fake.tagStore.has("Lead"), false);
  assert.equal(fake.tagStore.has("Bass"), false);
});

test("names are lowercased; a bad name is a usage error and nothing is written", async () => {
  const { run, fake } = setup({});
  assert.equal(logOf((await run({}, [lead], ["FX"]))!).startsWith("/Lead: +fx"), true);
  const bad = (await run({}, [bass], ["a b"]))!;
  assert.equal(bad.code, ExitCode.USAGE);
  assert.match(bad.message ?? "", /"a b" is not a tag name/);
  assert.equal(fake.tagStore.has("Bass"), false);
});

test("a script that is not running is exit 5", async () => {
  const { run, fake } = setup({});
  fake.api.tags.refresh = async () => fail(5, "Remote Script not running");
  const r = (await run({}, [lead], ["fx"]))!;
  assert.equal(r.code, ExitCode.UNAVAILABLE);
  assert.match(r.message ?? "", /not running/);
});

test("a failing write is reported per track", async () => {
  const { run, fake } = setup({});
  const write = fake.api.tags.write;
  fake.api.tags.write = (n, tags) => (n.name === "Bass" ? Promise.resolve(fail(1, "track changed")) : write(n, tags));
  const p = (await run({}, [lead, bass], ["fx"]))!;
  assert.equal(p.code, ExitCode.FAILURE);
  assert.equal(p.message, "tag: 1 of 2 done");
  assert.deepEqual(p.details?.map((d) => d.ok), [false]); // the dialog lists only the failures
  assert.match(logOf(p), /^\/Lead: \+fx/); // the successful write is in the log
});

test("an unmarked write is still exit 0 and says to save the Set", async () => {
  const { run, fake } = setup({});
  fake.api.tags.write = async (n, tags) => ({ ok: true, value: { name: n.name, tags, marked: false } });
  const r = (await run({}, [lead], ["fx"]))!;
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.message ?? "", /save the Set/);
  assert.doesNotMatch(logOf(r), /save the Set/);
});

test("a target without names opens the tag list with the target's tags lit and applies the marked ones", async () => {
  const { run, fake } = setup({ Lead: ["synth"], Bass: ["synth", "fx"] }, { pickTagsAnswer: () => ["fx"] });
  const r = (await run({}, [lead], []))!;
  assert.deepEqual(fake.tagLists[0]!.rows, [
    { name: "fx", count: 1, on: false },
    { name: "synth", count: 2, on: true },
  ]);
  assert.match(fake.tagLists[0]!.title, /\/Lead/);
  assert.equal(r.message, undefined);
  assert.equal(logOf(r).startsWith("/Lead: +fx"), true);
  assert.deepEqual(fake.tagStore.get("Lead"), ["synth", "fx"]);
});

test("a cancelled list changes nothing; a Set without tags still opens the list, with only the create row", async () => {
  const { run, fake } = setup({ Bass: ["fx"] }, { pickTagsAnswer: () => null });
  assert.equal(await run({}, [lead], []), undefined);
  assert.equal(fake.tagStore.has("Lead"), false);
  assert.equal(fake.tagLists[0]!.allowNew, true);
  const none = setup({}, { pickTagsAnswer: () => null });
  assert.equal(await none.run({}, [lead], []), undefined);
  assert.deepEqual(none.fake.tagLists[0]!.rows, []);
});

test("a created name is added to every target like an unlit row, with its undo line", async () => {
  const { run, fake } = setup({ Lead: ["fx"], Bass: ["fx"] }, { pickTagsAnswer: () => ["fx", "Perc"] });
  const r = (await run({}, [lead, bass], []))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(fake.tagStore.get("Lead"), ["perc"]); // fx was lit on both: removed; perc created
  assert.deepEqual(fake.tagStore.get("Bass"), ["perc"]);
  assert.match(logOf(r), /\/Lead: \+perc -fx/);
  assert.match(logOf(r), /undo: tag --set 0 \/Lead perc/);
});

test("a created name that is already a row follows that row; an invalid one is exit 2 and writes nothing", async () => {
  const same = setup({ Lead: ["fx"] }, { pickTagsAnswer: () => ["FX"] });
  const sr = await same.run({}, [lead], []);
  assert.equal(sr?.message, undefined);
  assert.equal(logOf(sr!), "/Lead: -fx (now no tags)\n  undo: tag --set 1 /Lead fx");
  const bad = setup({}, { pickTagsAnswer: () => ["FX!"] });
  const r = (await bad.run({}, [lead], []))!;
  assert.equal(r.code, ExitCode.USAGE);
  assert.equal(bad.fake.tagStore.has("Lead"), false);
});

test("changeLines quotes a path with spaces in the undo command", () => {
  const c = { before: [], after: ["fx"], added: ["fx"], removed: [] };
  assert.deepEqual(changeLines("/1 Audio", c), ["/1 Audio: +fx (now #fx)", '  undo: tag --set 0 "/1 Audio" fx']);
});

test("a pick with mixed targets applies each row uniformly, as the list promised", async () => {
  // fx: Lead has it, Bass not -> the row is off, so Enter adds it to both. drum: both have it -> lit, so it goes from both.
  const { run, fake } = setup({ Lead: ["fx", "drum"], Bass: ["drum"] }, { pickTagsAnswer: () => ["fx", "drum"] });
  const r = (await run({}, [lead, bass], []))!;
  assert.deepEqual(fake.tagLists[0]!.rows.map((x) => [x.name, x.on]), [["drum", true], ["fx", false]]);
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
  assert.deepEqual(fake.tagStore.get("Bass"), ["fx"]);
  assert.match(logOf(r), /^\/Lead: -drum \(now #fx\)/); // Lead already had fx
  assert.match(logOf(r), /\/Bass: \+fx -drum/);
});

test("--list takes no target, names or --set (exit 2); a bare tag is a usage error with the usage text", async () => {
  const { run } = setup({ Lead: ["fx"] });
  for (const [options, targets, names] of [[{ list: true }, [lead], []], [{ list: true }, [], ["fx"]], [{ list: true, set: "1" }, [], []]] as const) {
    const r = (await run(options as never, targets as never, names as never))!;
    assert.equal(r.code, ExitCode.USAGE);
  }
  const bare = (await run({}, [], []))!;
  assert.equal(bare.code, ExitCode.USAGE);
  assert.match(bare.message ?? "", /^missing argument <target>\nusage: tag/);
});
