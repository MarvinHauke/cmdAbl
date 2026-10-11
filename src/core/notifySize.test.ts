import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyCharsPerLine, notifySize } from "./notifySize.js";

test("notifySize: one short line gets the minimum size", () => {
  assert.deepEqual(notifySize("done"), { width: 500, height: 110 });
});

test("notifySize: a help-style listing is not wrapped", () => {
  const help = [
    "arm          arm or disarm tracks",
    "cmdabl       configure cmdAbl: --setup, --help",
    "goto         select an object by its path in the Live Set",
    "pakabl       browse and install extensions from the pakabl index",
    "usage: cmdabl <flag>",
    "  --setup  install keyboard trigger rule (Karabiner on macOS, AutoHotkey on Windows)",
  ].join("\n");
  const longest = Math.max(...help.split("\n").map((l) => l.length));
  const { width, height } = notifySize(help);
  assert.ok(longest <= notifyCharsPerLine(width), "longest line fits");
  assert.ok(width >= 500 && width <= 760);
  assert.equal(height, 65 + 18 * 6); // one row per line
});

test("notifySize: a 150-character path stays at 760 and wraps", () => {
  const path = "/" + "a".repeat(149);
  const { width, height } = notifySize(path);
  assert.equal(width, 760);
  const rows = Math.ceil(150 / notifyCharsPerLine(760));
  assert.equal(rows, 2);
  assert.equal(height, Math.max(110, 65 + 18 * rows)); // the minimum height applies
});

test("notifySize: 60 lines are capped at 420", () => {
  const text = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(notifySize(text).height, 420);
});

test("notifySize: empty text and blank lines count as one row each", () => {
  assert.deepEqual(notifySize(""), { width: 500, height: 110 });
  assert.equal(notifySize("a\n\n\n\n\n\nb").height, 65 + 18 * 7);
});

test("notifySize: a text with a very large number of lines does not throw", () => {
  const text = "x\n".repeat(300_000);
  assert.equal(notifySize(text).height, 420);
});
