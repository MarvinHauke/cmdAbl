import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE_HEIGHT, PALETTE_WIDTH } from "./paletteSize.js";

test("the palette opens 500 × 297 px (260 + the 37 px footer); no area above the prompt", () => {
  assert.equal(PALETTE_WIDTH, 500);
  assert.equal(PALETTE_HEIGHT, 297);
});
