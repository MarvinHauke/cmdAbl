import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { BoardAnswer, BoardRequest } from "../../core/ui.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { fail as bridgeFail } from "../../ableton/bridgeProtocol.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";
import { buildBoard, groupChanges, UNTAGGED_ID } from "./board.js";

const track = (name: string, i: number, scope = "regular") =>
  ({ name, path: `/${name}`, kind: "track", scope, route: [i], handleId: name }) as unknown as ObjectNode;
const all = [track("Lead", 0), track("Bass", 1), track("Drums", 2), track("A-Reverb", 0, "return"), track("Main", 0, "master")];

function setup(tags: Record<string, string[]>, answers: Array<BoardAnswer | null>) {
  let n = 0;
  const fake = createFakeApi({ nodes: all, tags, boardAnswer: () => answers[n++] ?? null });
  activate(fake.api);
  const run = (options: Record<string, string | true>) =>
    fake.commands[0]!.run!({ path: ["tag"], options, args: [[], []] } as never, undefined as never) as Promise<
      { code: number; message?: string; log?: string[]; details?: Array<{ ok: boolean }> } | undefined
    >;
  return { fake, run };
}

const logOf = (r: { log?: string[] }) => (r.log ?? []).join("\n");

test("buildBoard: a section per tag sorted by name with every track, a read-only untagged section last", () => {
  const board = buildBoard([
    { id: "l", label: "/Lead", tags: ["synth", "fx"] },
    { id: "b", label: "/Bass", tags: ["fx"] },
    { id: "d", label: "/Drums", tags: [] },
  ]);
  assert.deepEqual(board.sections.map((s) => [s.id, s.heading, s.meta]), [
    ["tag:fx", "#fx", "2 tracks"],
    ["tag:synth", "#synth", "1 track"],
    [UNTAGGED_ID, "untagged", "1 track"],
  ]);
  assert.deepEqual(board.sections[0]!.items, [
    { id: "l", label: "/Lead", on: true },
    { id: "b", label: "/Bass", on: true },
    { id: "d", label: "/Drums", on: false },
  ]);
  assert.equal(board.sections[2]!.readonly, true);
  assert.deepEqual(board.sections[2]!.items, [{ id: "d", label: "/Drums", on: true }]);
  assert.equal(board.create?.label, "New tag…");
  assert.equal(buildBoard([{ id: "l", label: "/Lead", tags: ["a"] }]).sections.some((s) => s.id === UNTAGGED_ID), false);
});

test("groupChanges: per track, created names lowercased, a bad name reported", () => {
  const ok = groupChanges({
    changes: [
      { section: "tag:fx", item: "l", on: false },
      { section: "Perc", item: "l", on: true },
      { section: "Perc", item: "b", on: true },
    ],
    created: ["Perc"],
  });
  assert.deepEqual([...ok.perTrack.entries()], [
    ["l", { add: ["perc"], remove: ["fx"] }],
    ["b", { add: ["perc"], remove: [] }],
  ]);
  assert.equal(groupChanges({ changes: [{ section: "a b", item: "l", on: true }], created: ["a b"] }).bad, "a b");
});

test("tag -l: the board lists regular and return tracks (never main); Close without applying says nothing", async () => {
  const { fake, run } = setup({ Lead: ["fx"] }, [null]);
  assert.equal(await run({ list: true }), undefined);
  const request = fake.boards[0] as BoardRequest;
  assert.deepEqual(request.sections[0]!.items.map((i) => i.id), ["Lead", "Bass", "Drums", "A-Reverb"]);
  assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]); // untouched
});

test("tag -l: Apply writes per track and ends with the result and its undo lines; the board does not reopen", async () => {
  const { fake, run } = setup({ Lead: ["fx"] }, [
    { changes: [{ section: "tag:fx", item: "Lead", on: false }, { section: "tag:fx", item: "Bass", on: true }, { section: "perc", item: "Bass", on: true }], created: ["perc"] },
    null,
  ]);
  const r = (await run({ list: true }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(fake.boards.length, 1); // not reopened
  assert.equal(fake.tagStore.get("Lead")?.length ?? 0, 0);
  assert.deepEqual(fake.tagStore.get("Bass"), ["fx", "perc"]);
  assert.equal(r.message, undefined);
  assert.match(logOf(r), /\/Lead: -fx/);
  assert.match(logOf(r), /\/Bass: \+fx \+perc/);
  assert.match(logOf(r), /undo: tag --set 1 \/Lead fx/);
});

test("tag -l: an empty answer closes; a failed write stops the loop and shows the failures", async () => {
  const empty = setup({}, [{ changes: [], created: [] }]);
  assert.equal(await empty.run({ list: true }), undefined);
  assert.equal(empty.fake.boards.length, 1);

  const { fake, run } = setup({}, [
    { changes: [{ section: "tag:fx", item: "Lead", on: true }, { section: "tag:fx", item: "Bass", on: true }], created: [] },
    null,
  ]);
  let writes = 0;
  const write = fake.api.tags.write;
  fake.api.tags.write = async (node, tags) => (++writes === 1 ? bridgeFail(5, "Remote Script not running") : write(node, tags));
  const r = (await run({ list: true }))!;
  assert.equal(r.code, ExitCode.UNAVAILABLE);
  assert.equal(writes, 1); // stopped at the first failure
  assert.equal(fake.boards.length, 1);
});

test("tag -l: script down is exit 5; a bad created name is exit 2; the list-cut note is added", async () => {
  const down = setup({}, []);
  down.fake.api.tags.refresh = async () => bridgeFail(5, "Remote Script not running");
  assert.equal((await down.run({ list: true }))?.code, ExitCode.UNAVAILABLE);

  const bad = setup({}, [{ changes: [{ section: "a b", item: "Lead", on: true }], created: ["a b"] }]);
  assert.equal((await bad.run({ list: true }))?.code, ExitCode.USAGE);

  const cut = setup({}, [{ changes: [{ section: "perc", item: "Lead", on: true }], created: ["perc"] }, null]);
  const base = cut.fake.api.ui.board;
  cut.fake.api.ui.board = async (request) => ({ ...(await base(request)), cut: true });
  assert.match(logOf((await cut.run({ list: true }))!), /list cut/);
});

test("tag -l: a created name is lowercased and merges into the existing tag of that name", async () => {
  const { fake, run } = setup({ Lead: ["fx"] }, [
    {
      changes: [
        { section: "Fx", item: "Bass", on: true }, // created "Fx" = existing #fx
        { section: "tag:fx", item: "Lead", on: false },
        { section: "Fx", item: "Lead", on: true }, // ticked in the new section, unticked in the old: the tick wins
        { section: "Perc", item: "Drums", on: true },
      ],
      created: ["Fx", "Perc"],
    },
    null,
  ]);
  const r = (await run({ list: true }))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(((fake.boards[0] as BoardRequest).create?.pattern ?? "").includes("A-Z"), true); // capitals are accepted
  assert.deepEqual(fake.tagStore.get("Bass"), ["fx"]);
  assert.deepEqual(fake.tagStore.get("Drums"), ["perc"]);
  assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
  assert.match(logOf(r), /\/Lead: no change/);
});
