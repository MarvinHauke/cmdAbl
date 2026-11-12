import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { fail as bridgeFail } from "../../ableton/bridgeProtocol.js";
import { createFakeApi } from "../shared/testPorts.js";
import { PAGE } from "./page.testkit.js";
import { activate } from "./command.js";

const track = (name: string, i: number, scope = "regular") =>
  ({ name, path: `/${name}`, kind: "track", scope, route: [i], handleId: name }) as unknown as ObjectNode;
const lead = track("Lead", 0);
const bass = track("Bass", 1);
const ret = track("A-Reverb", 0, "return");
const main = track("Main", 0, "master");
const all = [lead, bass, ret, main];

type Opts = Parameters<typeof createFakeApi>[0];
function setup(tags: Record<string, string[]>, extra: Opts = {}) {
  const fake = createFakeApi({ nodes: all, tags, ...extra });
  activate(fake.api, PAGE);
  const run = (options: Record<string, string | true>, targets: ObjectNode[] = [], names: string[] = []) =>
    fake.commands[0]!.run!({ path: ["tag"], options, args: [targets, names] } as never, undefined as never) as Promise<
      { code: number; message?: string; log?: string[] } | undefined
    >;
  return { fake, run };
}

const logOf = (r: { log?: string[] }) => (r.log ?? []).join("\n");

const requestOf = (fake: { dialogs: Array<{ html: string }> }): { tracks: Array<{ id: string; name: string }>; tags: Array<{ name: string; tracks: string[] }>; focus?: { tag?: string; track?: string }; view: string; filter: string; gear: boolean } => {
  const m = /const TAG_EDITOR = (.*);<\/script>/s.exec(fake.dialogs[0]!.html);
  return JSON.parse(m![1]!);
};
const answer = (apply: unknown): string => JSON.stringify({ apply });

test("--edit <tag> opens the editor with regular and return tracks (never the main), the tags and the tag in focus", async () => {
  const { fake, run } = setup({ Lead: ["fx"], Bass: ["synth"] }, { dialogAnswer: null, gearAvailable: true });
  assert.equal(await run({ edit: "fx" }), undefined);
  const req = requestOf(fake);
  assert.deepEqual(req.tracks.map((t) => t.name), ["Lead", "Bass", "A-Reverb"]);
  assert.deepEqual(req.tags, [{ name: "fx", tracks: ["Lead"] }, { name: "synth", tracks: ["Bass"] }]);
  assert.deepEqual(req.focus, { tag: "fx" });
  assert.deepEqual([req.view, req.filter, req.gear], ["list", "compact", true]);
  assert.equal(fake.dialogs[0]!.gear, true);
  const quiet = setup({});
  await quiet.run({ edit: "#" }); // a map binding or a chain: no gear
  assert.equal(requestOf(quiet.fake).gear, false);
  assert.equal(quiet.fake.dialogs[0]!.gear, false);
});

test("the settings choose the view and the filter", async () => {
  const { fake, run } = setup({}, { settings: { "tag.editView": "grid", "tag.filter": "highlight" } });
  await run({ edit: "#" });
  const req = requestOf(fake);
  assert.deepEqual([req.view, req.filter], ["grid", "highlight"]);
});

test("--edit without a tag (or #) opens on the first tag; a new name starts an empty tag", async () => {
  const bare = setup({ Lead: ["fx"], Bass: ["drum"] });
  await bare.run({ edit: "#" });
  assert.deepEqual(requestOf(bare.fake).focus, { tag: "drum" });
  const fresh = setup({ Lead: ["fx"] });
  await fresh.run({ edit: "Perc" });
  const req = requestOf(fresh.fake);
  assert.deepEqual(req.focus, { tag: "perc" });
  assert.deepEqual(req.tags.find((t) => t.name === "perc"), { name: "perc", tracks: [] });
});

test("a target without names opens the editor with that track in focus", async () => {
  const { fake, run } = setup({ Lead: ["fx"] });
  await run({}, [bass], []);
  assert.deepEqual(requestOf(fake).focus, { tag: "fx", track: "Bass" });
});

test("several targets open the editor without a track focus; --set without names is exit 2", async () => {
  const { fake, run } = setup({ Lead: ["fx"], Bass: ["fx"] });
  await run({}, [lead, bass], []);
  assert.deepEqual(requestOf(fake).focus, { tag: "fx" });
  assert.equal((await run({ set: "1" }, [lead], []))?.code, ExitCode.USAGE);
  assert.equal(fake.dialogs.length, 1);
});

test("closing writes nothing; the raw gear answer counts as closed", async () => {
  for (const dialogAnswer of [null, "", '{"settings":true}']) {
    const { fake, run } = setup({ Lead: ["fx"] }, { dialogAnswer });
    assert.equal(await run({ edit: "fx" }), undefined);
    assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
  }
});

test("Apply: renames, then removals, then the set with final names; the result says one undo step per track", async () => {
  const { fake, run } = setup(
    { Lead: ["fx", "old"], Bass: ["gone"] },
    { dialogAnswer: answer({ rename: [{ from: "old", to: "New" }], remove: ["gone"], set: [{ tag: "new", track: "Bass", on: true }, { tag: "fx", track: "Lead", on: false }] }) },
  );
  const r = (await run({ edit: "fx" }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(fake.tagStore.get("Lead"), ["new"]);
  assert.deepEqual(fake.tagStore.get("Bass"), ["new"]);
  assert.equal(r.message, "2 tracks changed (one undo step per track)");
  assert.match(logOf(r), /\/Lead: \+new -fx -old/);
  assert.match(logOf(r), /undo: tag --set 0 \/Lead new/);
});

test("Apply: a rename onto an existing tag merges and says so; an Apply that changes nothing says so", async () => {
  const merge = setup({ Lead: ["a", "b"] }, { dialogAnswer: answer({ rename: [{ from: "a", to: "b" }] }) });
  const r = (await merge.run({ edit: "a" }))!;
  assert.deepEqual(merge.fake.tagStore.get("Lead"), ["b"]);
  assert.match(r.message ?? "", /^merged #a into #b\n1 track changed \(one undo step per track\)$/);
  const none = setup({ Lead: ["a"] }, { dialogAnswer: answer({ set: [{ tag: "a", track: "Lead", on: true }] }) });
  assert.equal((await none.run({ edit: "a" }))?.message, "nothing changed");
});

test("Apply: an answer that does not fit the request is exit 2 and writes nothing", async () => {
  const bad: unknown[] = [
    { set: [{ tag: "fx", track: "Nope", on: true }] },
    { set: [{ tag: "F X", track: "Lead", on: true }] },
    { rename: [{ from: "ghost", to: "x" }] },
    { rename: [{ from: "fx", to: "A B" }] },
    { remove: ["ghost"] },
    { set: "everything" },
    { rename: [{ from: "fx", to: "perc" }], remove: ["perc"] },
    { rename: [{ from: "fx", to: "perc" }], set: [{ tag: "fx", track: "Lead", on: true }] },
  ];
  for (const apply of bad) {
    const { fake, run } = setup({ Lead: ["fx"] }, { dialogAnswer: answer(apply) });
    assert.equal((await run({ edit: "fx" }))?.code, ExitCode.USAGE, JSON.stringify(apply));
    assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
  }
  const notJson = setup({}, { dialogAnswer: "oops" });
  assert.equal((await notJson.run({ edit: "#" }))?.code, ExitCode.USAGE);
});

test("a failing write stops Apply and reports the tracks", async () => {
  const { fake, run } = setup({}, { dialogAnswer: answer({ set: [{ tag: "fx", track: "Lead", on: true }, { tag: "fx", track: "Bass", on: true }] }) });
  const write = fake.api.tags.write;
  fake.api.tags.write = (n, tags) => (n.name === "Lead" ? Promise.resolve(bridgeFail(1, "track changed")) : write(n, tags));
  const r = (await run({ edit: "fx" }))!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.equal(fake.tagStore.has("Bass"), false);
});

test("--edit usage errors are exit 2 and write nothing; script down is exit 5", async () => {
  const { run, fake } = setup({});
  for (const [options, targets, names] of [
    [{ edit: "fx" }, [lead], []],
    [{ edit: "fx" }, [], ["synth"]],
    [{ edit: "fx", list: true }, [], []],
    [{ edit: "fx", set: "1" }, [], []],
    [{ edit: "FX!" }, [], []],
  ] as const) {
    assert.equal((await run(options as never, targets as never, names as never))?.code, ExitCode.USAGE, JSON.stringify(options));
  }
  assert.equal(fake.tagStore.size, 0);
  const down = setup({}, {});
  down.fake.api.tags.refresh = async () => bridgeFail(5, "Remote Script not running");
  assert.equal((await down.run({ edit: "fx" }))?.code, ExitCode.UNAVAILABLE);
});

test("--edit declares # as its default, so a bare tag -e is tag -e #", () => {
  const { fake } = setup({});
  const edit = fake.commands[0]!.options?.find((o) => o.name === "edit");
  assert.equal(edit?.valueDefault, "#");
});
