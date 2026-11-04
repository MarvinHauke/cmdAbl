import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSize, capBoard, parseBoardAnswer, runBoard } from "./board.js";
import type { BoardRequest } from "./ui.js";

const request: BoardRequest = {
  title: "tags",
  sections: [
    { id: "drums", heading: "#drums", meta: "1 track", items: [{ id: "/Bass", label: "/Bass", on: true }, { id: "/Lead", label: "/Lead", on: false }] },
    { id: "fx", heading: "#fx", items: [{ id: "/Bass", label: "/Bass", on: false }, { id: "/Lead", label: "/Lead", on: false }] },
    { id: "untagged", heading: "untagged", readonly: true, items: [{ id: "/Lead", label: "/Lead", on: true }] },
  ],
  create: { label: "New tag…", pattern: "[a-z0-9_-]+" },
  apply: { label: "Apply" },
};
const quiet = () => {};
const parse = (value: unknown) => parseBoardAnswer(JSON.stringify(value), request, quiet);

test("parseBoardAnswer: keeps real changes, drops unknown ids, readonly sections, no-ops", () => {
  const answer = parse({
    changes: [
      { section: "drums", item: "/Lead", on: true },
      { section: "drums", item: "/Bass", on: true }, // already on
      { section: "fx", item: "/Nope", on: true },
      { section: "nope", item: "/Lead", on: true },
      { section: "untagged", item: "/Lead", on: false }, // readonly
      { section: "fx", item: "/Bass", on: "yes" },
      "junk",
    ],
    created: [],
  });
  assert.deepEqual(answer, { changes: [{ section: "drums", item: "/Lead", on: true }], created: [] });
});

test("parseBoardAnswer: of two changes to the same section and item the last wins", () => {
  const answer = parse({ changes: [{ section: "fx", item: "/Lead", on: true }, { section: "fx", item: "/Lead", on: false }, { section: "fx", item: "/Lead", on: true }], created: [] });
  assert.deepEqual(answer!.changes, [{ section: "fx", item: "/Lead", on: true }]);
  // on then back off = no net change
  assert.deepEqual(parse({ changes: [{ section: "fx", item: "/Lead", on: true }, { section: "fx", item: "/Lead", on: false }] })!.changes, []);
});

test("parseBoardAnswer: created sections must match the pattern; a change may name one", () => {
  const answer = parse({
    created: ["perc", " perc ", "Bad Name", "", "drums", 5, "x".repeat(400)],
    changes: [{ section: "perc", item: "/Lead", on: true }, { section: "perc", item: "/Lead", on: false }, { section: "perc", item: "/Nope", on: true }, { section: "other", item: "/Lead", on: true }],
  });
  assert.deepEqual(answer, { created: ["perc"], changes: [] }); // Lead ends off (a no-op for a new section); /Nope and "other" are unknown
  const kept = parse({ created: ["perc"], changes: [{ section: "perc", item: "/Lead", on: true }, { section: "perc", item: "/Bass", on: true }] });
  assert.deepEqual(kept, { created: ["perc"], changes: [{ section: "perc", item: "/Lead", on: true }, { section: "perc", item: "/Bass", on: true }] });
});

test("parseBoardAnswer: no create in the request keeps no created sections; a bad pattern keeps none", () => {
  const without = parseBoardAnswer(JSON.stringify({ created: ["perc"], changes: [{ section: "perc", item: "/Lead", on: true }] }), { ...request, create: undefined }, quiet);
  assert.deepEqual(without, { changes: [], created: [] });
  const bad = parseBoardAnswer(JSON.stringify({ created: ["perc"] }), { ...request, create: { label: "x", pattern: "(" } }, quiet);
  assert.deepEqual(bad, { changes: [], created: [] });
  const open = parseBoardAnswer(JSON.stringify({ created: ["Any Name"] }), { ...request, create: { label: "x" } }, quiet);
  assert.deepEqual(open!.created, ["Any Name"]);
});

test("parseBoardAnswer: garbage is null with a log line, never a throw", () => {
  const logs: string[] = [];
  const log = (l: string) => void logs.push(l);
  for (const raw of [null, undefined, "", "not json", "[]", "5", "null", '{"changes":5}', '{"created":"x"}']) {
    assert.equal(parseBoardAnswer(raw, request, log), null, String(raw));
  }
  assert.ok(logs.length >= 5);
  // missing lists are fine
  assert.deepEqual(parseBoardAnswer("{}", request, log), { changes: [], created: [] });
});

test("capBoard: caps sections, items and texts and says so; clean requests are untouched", () => {
  const clean = capBoard(request);
  assert.equal(clean.cut, false);
  assert.deepEqual(clean.request, request);
  const big: BoardRequest = {
    title: "t",
    sections: Array.from({ length: 45 }, (_, i) => ({
      id: `s${i}`,
      heading: "h".repeat(400),
      items: Array.from({ length: 210 }, (_, j) => ({ id: `i${j}`, label: `l${j}`, on: j % 2 === 0 })),
    })),
    apply: { label: "Apply" },
  };
  const capped = capBoard(big);
  assert.equal(capped.cut, true);
  assert.equal(capped.request.sections.length, 40);
  assert.equal(capped.request.sections[0]!.items.length, 200);
  assert.equal(capped.request.sections[0]!.heading.length, 300);
});

test("capBoard: sections without id or heading and duplicate ids are dropped", () => {
  const out = capBoard({
    title: "t",
    sections: [
      { id: "a", heading: "A", items: [{ id: "x", label: "x", on: true }, { id: "x", label: "again", on: false }, { id: "", label: "no id", on: true }] },
      { id: "a", heading: "dup", items: [] },
      { id: "", heading: "no id", items: [] },
      { id: "b", heading: "  ", items: [] },
    ],
    apply: { label: "" },
  });
  assert.equal(out.cut, true);
  assert.deepEqual(out.request.sections, [{ id: "a", heading: "A", items: [{ id: "x", label: "x", on: true }] }]);
  assert.equal(out.request.apply.label, "Apply");
});

test("boardSize stays within sensible bounds and grows with the content", () => {
  const small = boardSize(request);
  assert.ok(small.width >= 600 && small.width <= 760);
  assert.ok(small.height >= 320 && small.height <= 560);
  const many = boardSize({ ...request, sections: Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, heading: `#t${i}`, items: Array.from({ length: 50 }, (_, j) => ({ id: `${j}`, label: `/Track ${j}`, on: true })) })) });
  assert.ok(many.height >= small.height && many.height <= 560);
});

test("runBoard: caps first, reports the cut, and a failing surface counts as closed", async () => {
  const seen: BoardRequest[] = [];
  const answer = { changes: [], created: [] };
  const ui = { board: async (r: BoardRequest) => (seen.push(r), answer) };
  const big = { ...request, sections: [{ id: "a", heading: "x".repeat(400), items: [] }] };
  const out = await runBoard(ui, big);
  assert.equal(out.cut, true);
  assert.equal(out.answer, answer);
  assert.equal(seen[0]!.sections[0]!.heading.length, 300);
  const broken = await runBoard({ board: async () => { throw new Error("x"); } }, request);
  assert.deepEqual(broken, { answer: null, cut: false });
});

test("capBoard: an over-long id is dropped, never shortened", () => {
  const out = capBoard({ title: "t", sections: [{ id: "a", heading: "A", items: [{ id: "x".repeat(301), label: "l", on: true }, { id: "ok", label: "l".repeat(400), on: false }] }, { id: "s".repeat(301), heading: "B", items: [] }], apply: { label: "Apply" } });
  assert.equal(out.cut, true);
  assert.equal(out.request.sections.length, 1);
  assert.deepEqual(out.request.sections[0]!.items.map((i) => i.id), ["ok"]);
  assert.equal(out.request.sections[0]!.items[0]!.label.length, 300);
});

// ── rename and remove whole sections (plan 0010) ───────────────────────────────────────────────────

const editable: BoardRequest = {
  ...request,
  sections: request.sections.map((s) => (s.id === "untagged" ? s : { ...s, renamable: true, removable: true })),
};
const parseEdit = (value: unknown, req: BoardRequest = editable) => parseBoardAnswer(JSON.stringify(value), req, quiet);

test("capBoard keeps the renamable and removable flags (true only) and old requests are unchanged", () => {
  const capped = capBoard({ ...editable, sections: [...editable.sections, { id: "x", heading: "x", items: [], renamable: "yes" as never, removable: 1 as never }] }).request;
  assert.deepEqual(capped.sections.map((s) => [s.id, s.renamable === true, s.removable === true]), [["drums", true, true], ["fx", true, true], ["untagged", false, false], ["x", false, false]]);
  assert.ok(!("renamable" in capBoard(request).request.sections[0]!));
});

test("parseBoardAnswer: renames are kept for renamable sections, trimmed, matching create.pattern, last one wins", () => {
  const answer = parseEdit({
    changes: [],
    created: [],
    renamed: [
      { section: "drums", to: "  perc " },
      { section: "fx", to: "Bad Name" }, // does not match [a-z0-9_-]+
      { section: "fx", to: "" },
      { section: "fx", to: "fx" }, // its own name
      { section: "drums", to: "percussion" }, // the last for drums
      { section: "nope", to: "x" }, // unknown section
      { section: "untagged", to: "x" }, // not renamable
      { section: "fx", to: 5 },
      "junk",
      null,
    ],
  });
  assert.deepEqual(answer, { changes: [], created: [], renamed: [{ section: "drums", to: "percussion" }] });
});

test("parseBoardAnswer: a rename to an existing name is kept (the module merges); length limits apply", () => {
  assert.deepEqual(parseEdit({ renamed: [{ section: "drums", to: "fx" }] })!.renamed, [{ section: "drums", to: "fx" }]);
  assert.equal(parseEdit({ renamed: [{ section: "drums", to: "a".repeat(400) }] })!.renamed, undefined);
  // a request with no create.pattern: any non-empty text is a name; no create at all: the same
  const loose: BoardRequest = { ...editable, create: { label: "New" } };
  assert.deepEqual(parseEdit({ renamed: [{ section: "drums", to: "Any Name" }] }, loose)!.renamed, [{ section: "drums", to: "Any Name" }]);
  const noCreate: BoardRequest = { ...editable, create: undefined };
  assert.deepEqual(parseEdit({ renamed: [{ section: "drums", to: "Any Name" }] }, noCreate)!.renamed, [{ section: "drums", to: "Any Name" }]);
  // an invalid create.pattern: no rename can be checked, so none is kept (as with created)
  const broken: BoardRequest = { ...editable, create: { label: "New", pattern: "(" } };
  assert.equal(parseEdit({ renamed: [{ section: "drums", to: "x" }] }, broken)!.renamed, undefined);
});

test("parseBoardAnswer: removals are kept for removable sections, once each; removed wins over renamed", () => {
  const answer = parseEdit({
    changes: [],
    created: [],
    removed: ["fx", "fx", "untagged", "nope", 7, "drums"],
    renamed: [{ section: "drums", to: "perc" }, { section: "fx", to: "effects" }],
  });
  assert.deepEqual(answer!.removed, ["fx", "drums"]);
  assert.equal(answer!.renamed, undefined); // both renamed sections were removed
  const partial = parseEdit({ removed: ["fx"], renamed: [{ section: "drums", to: "perc" }, { section: "fx", to: "effects" }] });
  assert.deepEqual(partial, { changes: [], created: [], renamed: [{ section: "drums", to: "perc" }], removed: ["fx"] });
});

test("parseBoardAnswer: a request without the flags gets neither field; a created section is neither renamable nor removable", () => {
  assert.deepEqual(parse({ renamed: [{ section: "drums", to: "perc" }], removed: ["fx"] }), { changes: [], created: [] });
  const answer = parseEdit({ created: ["new"], renamed: [{ section: "new", to: "other" }], removed: ["new"] });
  assert.deepEqual(answer, { changes: [], created: ["new"] });
});

test("parseBoardAnswer: renamed or removed that are not lists make the answer unreadable (null)", () => {
  assert.equal(parseEdit({ renamed: "x" }), null);
  assert.equal(parseEdit({ removed: { a: 1 } }), null);
  assert.deepEqual(parseEdit({ changes: [], created: [] }), { changes: [], created: [] }); // old answers are exactly as before
});

test("parseBoardAnswer: confirmed is kept only as true and only together with a non-empty removed", () => {
  assert.deepEqual(parseEdit({ removed: ["fx"], confirmed: true }), { changes: [], created: [], removed: ["fx"], confirmed: true });
  assert.equal(parseEdit({ removed: ["fx"], confirmed: "yes" })!.confirmed, undefined);
  assert.equal(parseEdit({ removed: ["fx"], confirmed: false })!.confirmed, undefined);
  assert.equal(parseEdit({ removed: ["fx"] })!.confirmed, undefined);
  assert.equal(parseEdit({ removed: [], confirmed: true })!.confirmed, undefined); // nothing removed
  assert.equal(parseEdit({ removed: ["nope"], confirmed: true })!.confirmed, undefined); // the removal was dropped
  assert.deepEqual(parseEdit({ changes: [], created: [], confirmed: true }), { changes: [], created: [] });
});
