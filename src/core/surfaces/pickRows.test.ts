import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRowIndex } from "./pick.js";
import type { SelectRequest, Ui } from "./ui.js";

function uiAnswering(answer: unknown, seen: SelectRequest[]): Ui {
  return { select: async (request: SelectRequest) => (seen.push(request), answer) } as unknown as Ui;
}

const rows = [{ label: "a" }, { label: "b", detail: "x", disabled: true }, { label: "c" }];

test("pickRowIndex: a single-select request with cursor and disabled rows; answers the index", async () => {
  const seen: SelectRequest[] = [];
  assert.equal(await pickRowIndex(uiAnswering([2], seen), { title: "T", rows, cursor: 2 }), 2);
  assert.equal(seen[0]!.multi, false);
  assert.equal(seen[0]!.cursor, 2);
  assert.deepEqual(seen[0]!.items, [{ label: "a" }, { label: "b", detail: "x", disabled: true }, { label: "c" }]);
});

test("pickRowIndex: no cursor key without a cursor; cancelled, fill and a disabled answer are null", async () => {
  const seen: SelectRequest[] = [];
  assert.equal(await pickRowIndex(uiAnswering([0], seen), { title: "T", rows }), 0);
  assert.equal("cursor" in seen[0]!, false);
  assert.equal(await pickRowIndex(uiAnswering(null, []), { title: "T", rows }), null);
  assert.equal(await pickRowIndex(uiAnswering({ fill: 0 }, []), { title: "T", rows }), null);
  assert.equal(await pickRowIndex(uiAnswering([1], []), { title: "T", rows }), null);
  assert.equal(await pickRowIndex(uiAnswering([9], []), { title: "T", rows }), null);
});
