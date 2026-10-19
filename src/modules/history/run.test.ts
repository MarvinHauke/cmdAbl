import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode, type CommandResult } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

function setup(confirmAnswer = false) {
  const fake = createFakeApi({ confirmAnswer });
  let listener: (inv: string) => void = () => {};
  fake.api.onCommandRun = (l) => void (listener = l);
  let items: () => Array<{ title: string }> = () => [];
  fake.api.registerProvider = (p) => void (items = p.getItems as never);
  activate(fake.api);
  const root = fake.commands[0]!;
  const run = async (sub: string, options: Record<string, string | true> = {}): Promise<CommandResult> => {
    const c = root.children!.find((x) => x.name === sub)!;
    return ((await c.run!({ path: ["history", sub], options, args: [] } as never, undefined as never)) ?? { code: 0 }) as CommandResult;
  };
  return { fake, run, ran: (i: string) => listener(i), titles: () => items().map((i) => i.title) };
}

test("history commands are never recorded", async () => {
  const t = setup();
  t.ran("mute /Lead");
  t.ran("history clear --force");
  t.ran("history");
  assert.deepEqual(t.titles(), ["mute /Lead"]);
});

test("clear asks, moves everything aside on yes and keeps it on no", async () => {
  const no = setup(false);
  no.ran("mute /Lead");
  const kept = await no.run("clear");
  assert.equal(kept.code, ExitCode.OK);
  assert.match(kept.message ?? "", /kept/);
  assert.deepEqual(no.titles(), ["mute /Lead"]);
  assert.match(no.fake.confirms[0]!, /^Clear the history entry\? It can be restored/);

  const yes = setup(true);
  yes.ran("mute /Lead");
  yes.ran("solo /Bass");
  assert.equal((await yes.run("clear")).code, ExitCode.OK);
  assert.match(yes.fake.confirms[0]!, /^Clear all 2 history entries\? They can be restored/);
  assert.deepEqual(yes.titles(), []);
  assert.match((await yes.run("restore")).message ?? "", /restored 2 entries/);
  assert.deepEqual(yes.titles(), ["solo /Bass", "mute /Lead"]);
});

test("clear --force asks nothing and leaves nothing to restore", async () => {
  const t = setup(false);
  t.ran("mute /Lead");
  assert.equal((await t.run("clear", { force: true })).code, ExitCode.OK);
  assert.deepEqual(t.fake.confirms, []);
  assert.deepEqual(t.titles(), []);
  assert.match((await t.run("restore")).message ?? "", /nothing to restore/);
});

test("forget drops the newest entries; an empty history answers so", async () => {
  const t = setup();
  assert.match((await t.run("forget")).message ?? "", /history is empty/);
  assert.match((await t.run("clear")).message ?? "", /history is empty/);
  t.ran("a");
  t.ran("b");
  t.ran("c");
  await t.run("forget", { count: "2" });
  assert.deepEqual(t.titles(), ["a"]);
  assert.equal((await t.run("restore", { count: "1" })).code, ExitCode.OK);
  assert.deepEqual(t.titles(), ["c", "a"]); // the most recently removed returns first
});
