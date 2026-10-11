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
  assert.equal(height, 72 + 18 * 6); // one row per line
});

test("notifySize: a 66-character line gets a width that fits it, with no slack row", () => {
  const line = "x".repeat(66);
  const { width, height } = notifySize(`${line}\nshort\nshort`);
  assert.ok(width >= Math.ceil(66 * 8.05) + 32 + 8, `width ${width}`);
  assert.ok(notifyCharsPerLine(width) >= 66);
  assert.equal(height, 72 + 18 * 3);
});

test("notifySize: the cmdabl usage text fits the maximum width without wrapping", async () => {
  const { cmdablUsage } = await import("./builtins.js");
  const text = cmdablUsage();
  const longest = Math.max(...text.split("\n").map((l) => l.length));
  const { width, height } = notifySize(text);
  assert.ok(longest * 8.05 + 40 <= 760, `longest line ${longest} characters`);
  assert.ok(notifyCharsPerLine(width) >= longest);
  assert.equal(height, 72 + 18 * text.split("\n").length);
});

test("notifySize: a 150-character path stays at 760 and wraps", () => {
  const path = "/" + "a".repeat(149);
  const { width, height } = notifySize(path);
  assert.equal(width, 760);
  const rows = Math.ceil(150 / notifyCharsPerLine(760));
  assert.equal(rows, 2);
  assert.equal(height, 72 + 18 * (rows + 1)); // one line of slack where a line wraps
});

test("notifySize: 60 lines are capped at 420", () => {
  const text = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(notifySize(text).height, 420);
});

test("notifySize: empty text and blank lines count as one row each", () => {
  assert.deepEqual(notifySize(""), { width: 500, height: 110 });
  assert.equal(notifySize("a\n\n\n\n\n\nb").height, 72 + 18 * 7);
});

test("notifySize: a text with a very large number of lines does not throw", () => {
  const text = "x\n".repeat(300_000);
  assert.equal(notifySize(text).height, 420);
});

// Guards the content height measured in Live (66.5 px around the text) plus a margin.
test("notifySize: unwrapped text gets at least 4 px more than it measurably needs", () => {
  for (const lineCount of [3, 6, 14]) {
    const text = Array.from({ length: lineCount }, (_, i) => `line ${i}`).join("\n");
    const needed = lineCount * 18 + 66.5; // as measured in Live
    assert.ok(notifySize(text).height >= needed + 4, `${lineCount} lines`);
  }
});
