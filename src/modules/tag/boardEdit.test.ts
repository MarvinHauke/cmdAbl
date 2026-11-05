import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { BoardAnswer } from "../../core/ui.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";
import { boardTagEdits, buildBoard, finalTags } from "./board.js";

const track = (name: string, i: number, scope = "regular") =>
  ({ name, path: `/${name}`, kind: "track", scope, route: [i], handleId: name }) as unknown as ObjectNode;
const all = [track("Lead", 0), track("Bass", 1), track("Drums", 2), track("A-Reverb", 0, "return"), track("Main", 0, "master")];

function setup(tags: Record<string, string[]>, answer: Partial<BoardAnswer>, confirmAnswer = true) {
  const fake = createFakeApi({ nodes: all, tags, confirmAnswer, boardAnswer: () => ({ changes: [], created: [], ...answer }) as BoardAnswer });
  activate(fake.api);
  const run = () =>
    fake.commands[0]!.run!({ path: ["tag"], options: { list: true }, args: [[], []] } as never, undefined as never) as Promise<
      { code: number; message?: string; log?: string[] } | undefined
    >;
  return { fake, run };
}

test("the board marks every tag section renamable and removable, not the untagged one", () => {
  const board = buildBoard([{ id: "l", label: "/Lead", tags: ["fx"] }, { id: "b", label: "/Bass", tags: [] }]);
  assert.equal(board.sections[0]!.renamable, true);
  assert.equal(board.sections[0]!.removable, true);
  assert.equal(board.sections[1]!.renamable, undefined);
  assert.equal(board.sections[1]!.removable, undefined);
});

test("boardTagEdits: removal wins over a rename of the same section; same-name renames and non-tag sections are dropped; a bad name is reported", () => {
  const edits = boardTagEdits({
    changes: [],
    created: [],
    renamed: [{ section: "tag:fx", to: "effects" }, { section: "tag:a", to: "b" }, { section: "tag:same", to: "same" }, { section: "~untagged", to: "x" }],
    removed: ["tag:a"],
  });
  assert.deepEqual([...edits.renames], [["fx", "effects"]]);
  assert.deepEqual([...edits.removed], ["a"]);
  assert.equal(boardTagEdits({ changes: [], created: [], renamed: [{ section: "tag:fx", to: "no way" }] }).bad, "no way");
});

test("finalTags: renames, then removals, then chip changes that follow a rename", () => {
  const edits = boardTagEdits({ changes: [], created: [], renamed: [{ section: "tag:fx", to: "effects" }], removed: ["tag:old"] });
  assert.deepEqual(finalTags(["fx", "old", "synth"], undefined, edits), ["effects", "synth"]);
  assert.deepEqual(finalTags(["fx", "effects"], undefined, edits), ["effects"]); // merge
  assert.deepEqual(finalTags(["synth"], { add: ["fx", "old"], remove: [] }, edits), ["synth", "effects"]);
  assert.deepEqual(finalTags(["fx", "synth"], { add: [], remove: ["fx"] }, edits), ["synth"]);
});

test("Apply renames a tag (merging into an existing name) and logs the change and undo lines", async () => {
  const { fake, run } = setup({ Lead: ["fx", "synth"], Bass: ["fx", "effects"], Drums: ["drums"] }, { renamed: [{ section: "tag:fx", to: "effects" }] });
  const r = (await run())!;
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.message!, /merged #fx into #effects/);
  assert.deepEqual(fake.tagStore.get("Lead"), ["effects", "synth"]);
  assert.deepEqual(fake.tagStore.get("Bass"), ["effects"]);
  assert.deepEqual(fake.tagStore.get("Drums"), ["drums"]);
  assert.match((r.log ?? []).join("\n"), /undo: tag --set/);
  assert.equal(fake.confirms.length, 0); // renames ask nothing
});

test("an answer the board confirmed (confirmed: true) removes without a second question", async () => {
  const { fake, run } = setup({ Lead: ["fx", "synth"], Bass: ["fx"], Drums: ["drums"] }, { removed: ["tag:fx"], confirmed: true });
  const r = (await run())!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(fake.confirms.length, 0);
  assert.deepEqual(fake.tagStore.get("Lead"), ["synth"]);
  assert.deepEqual(fake.tagStore.get("Bass") ?? [], []);
  assert.match((r.log ?? []).join("\n"), /undo: tag --set 1 \/Bass fx/);
});

test("without confirmed the module asks once: 'Remove #fx from 2 tracks?' (several tags: one question, distinct tracks)", async () => {
  const one = setup({ Lead: ["fx", "synth"], Bass: ["fx"], Drums: ["drums"] }, { removed: ["tag:fx"] });
  const r = (await one.run())!;
  assert.deepEqual(one.fake.confirms, ["Remove #fx from 2 tracks?"]);
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(one.fake.tagStore.get("Lead"), ["synth"]);
  const many = setup({ Lead: ["fx", "pad"], Bass: ["fx"], Drums: ["pad"] }, { removed: ["tag:fx", "tag:pad"] });
  await many.run();
  assert.deepEqual(many.fake.confirms, ["Remove #fx, #pad from 3 tracks?"]);
});

test("without confirmed, Cancel applies nothing from the board and says so", async () => {
  const { fake, run } = setup(
    { Lead: ["fx"], Bass: ["pad"] },
    { removed: ["tag:fx"], renamed: [{ section: "tag:pad", to: "keys" }], changes: [{ section: "tag:pad", item: "Lead", on: true }] },
    false,
  );
  const r = (await run())!;
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.message!, /cancelled; nothing from the board was applied/);
  assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
  assert.deepEqual(fake.tagStore.get("Bass"), ["pad"]);
});

test("rename, removal and chip changes in one Apply, in that order", async () => {
  const { fake, run } = setup(
    { Lead: ["fx", "old"], Bass: ["synth"] },
    {
      renamed: [{ section: "tag:fx", to: "effects" }],
      removed: ["tag:old"],
      changes: [{ section: "tag:fx", item: "Bass", on: true }, { section: "tag:synth", item: "Lead", on: true }],
    },
  );
  await run();
  assert.deepEqual(fake.tagStore.get("Lead"), ["effects", "synth"]);
  assert.deepEqual(fake.tagStore.get("Bass"), ["synth", "effects"]);
});

test("a bad rename name is exit 2 and writes nothing", async () => {
  const { fake, run } = setup({ Lead: ["fx"] }, { renamed: [{ section: "tag:fx", to: "no way" }] });
  const r = (await run())!;
  assert.equal(r.code, ExitCode.USAGE);
  assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
});

test("a swap (A->B and B->A) works; a rename to a tag removed in the same Apply is refused", async () => {
  const swap = setup({ Lead: ["a"], Bass: ["b"] }, { renamed: [{ section: "tag:a", to: "b" }, { section: "tag:b", to: "a" }] });
  await swap.run();
  assert.deepEqual(swap.fake.tagStore.get("Lead"), ["b"]);
  assert.deepEqual(swap.fake.tagStore.get("Bass"), ["a"]);
  const clash = setup({ Lead: ["a"], Bass: ["b"] }, { renamed: [{ section: "tag:a", to: "b" }], removed: ["tag:b"] });
  const r = (await clash.run())!;
  assert.equal(r.code, ExitCode.USAGE);
  assert.match(r.message!, /cannot be renamed to #b, which is being removed/);
  assert.deepEqual(clash.fake.tagStore.get("Lead"), ["a"]);
});
