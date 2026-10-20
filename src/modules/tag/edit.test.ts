import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { fail as bridgeFail } from "../../ableton/bridgeProtocol.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

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
  activate(fake.api);
  const run = (options: Record<string, string | true>, targets: ObjectNode[] = [], names: string[] = []) =>
    fake.commands[0]!.run!({ path: ["tag"], options, args: [targets, names] } as never, undefined as never) as Promise<
      { code: number; message?: string; log?: string[] } | undefined
    >;
  return { fake, run };
}

const logOf = (r: { log?: string[] }) => (r.log ?? []).join("\n");

test("--edit <tag> lists regular and return tracks (never the main) lit where tagged, and toggles the marked ones", async () => {
  const { fake, run } = setup(
    { Lead: ["fx"], Bass: ["synth"] },
    { pickAnswer: (c) => c.filter((n) => n.name === "Lead" || n.name === "Bass") },
  );
  const r = (await run({ edit: "fx" }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(fake.pickStates, [{ label: "tagged fx", values: [true, false, false], change: "toggle" }]);
  assert.deepEqual(fake.tagStore.get("Bass"), ["synth", "fx"]);
  assert.equal(r.message, undefined);
  assert.match(logOf(r), /\/Lead: -fx/);
  assert.match(logOf(r), /\/Bass: \+fx/);
  assert.match(logOf(r), /undo: tag --set 1 \/Lead fx/);
});

test("--edit: Esc changes nothing; a #fx value works like fx", async () => {
  const none = setup({}, { pickAnswer: () => null });
  assert.equal(await none.run({ edit: "fx" }), undefined);
  assert.equal(none.fake.tagStore.size, 0);
  const hash = setup({}, { pickAnswer: (c) => [c[0]!] });
  assert.equal((await hash.run({ edit: "#Fx" }))?.code, ExitCode.OK);
  assert.deepEqual(hash.fake.tagStore.get("Lead"), ["fx"]);
});

test("--edit # asks for the tag first (single choice, a new name allowed), then the tracks", async () => {
  const { fake, run } = setup({ Lead: ["fx"] }, { pickTagsAnswer: () => ["Perc"], pickAnswer: (c) => [c[1]!] });
  const r = (await run({ edit: "#" }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(fake.tagLists[0]!.allowNew, true);
  assert.deepEqual(fake.tagLists[0]!.rows, [{ name: "fx", count: 1 }]);
  assert.deepEqual(fake.pickStates[0]!.label, "tagged perc");
  assert.deepEqual(fake.tagStore.get("Bass"), ["perc"]);
  const cancelled = setup({}, { pickTagsAnswer: () => null });
  assert.equal(await cancelled.run({ edit: "#" }), undefined);
  assert.equal(cancelled.fake.pickStates.length, 0);
  const two = setup({}, { pickTagsAnswer: () => ["a", "b"] });
  assert.equal((await two.run({ edit: "#" }))?.code, ExitCode.USAGE);
});

test("--edit usage errors are exit 2 and write nothing; script down is exit 5", async () => {
  const { run, fake } = setup({}, { pickAnswer: (c) => [c[0]!] });
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
