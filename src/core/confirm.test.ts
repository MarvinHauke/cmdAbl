import { test } from "node:test";
import assert from "node:assert/strict";
import { confirm } from "./confirm.js";
import type { SelectRequest, Ui } from "./ui.js";

function uiAnswering(answer: number[] | { fill: number } | null | "throw") {
  const requests: SelectRequest[] = [];
  const ui = {
    select: async (r: SelectRequest) => {
      requests.push(r);
      if (answer === "throw") throw new Error("dialog failed");
      return answer;
    },
  } as unknown as Ui;
  return { ui, requests };
}

test("confirm: asks a single-select list with the message and two rows", async () => {
  const { ui, requests } = uiAnswering([0]);
  assert.equal(await confirm(ui, "Delete all history?", "Delete"), true);
  assert.equal(requests[0]!.title, "Delete all history?");
  assert.equal(requests[0]!.multi, false);
  assert.deepEqual(requests[0]!.items.map((i) => i.label), ["Delete", "Cancel"]);
  assert.equal(requests[0]!.fill, undefined);
});

test("confirm: Cancel, Esc, a fill answer and a failing dialog are all false", async () => {
  for (const answer of [[1], null, { fill: 0 }, "throw", []] as const) {
    assert.equal(await confirm(uiAnswering(answer as never).ui, "Sure?", "Yes"), false);
  }
});
