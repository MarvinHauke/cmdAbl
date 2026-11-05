import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE_HEIGHT, PALETTE_WIDTH } from "./paletteSize.js";

test("the palette opens 500 × 311 px (260 + the 51 px footer); no area above the prompt", () => {
  assert.equal(PALETTE_WIDTH, 500);
  assert.equal(PALETTE_HEIGHT, 311);
});
