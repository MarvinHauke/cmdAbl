import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE_WIDTH, paletteHeight } from "./paletteSize.js";

test("the palette opens 260 px high, 360 with the hint panel, 410 with the option rows; anything else is 260", () => {
  assert.equal(PALETTE_WIDTH, 500);
  assert.equal(paletteHeight("off"), 260);
  assert.equal(paletteHeight("hints"), 360);
  assert.equal(paletteHeight("options"), 410);
  for (const odd of [undefined, "", "both", "toString", "__proto__"]) assert.equal(paletteHeight(odd), 260, String(odd));
});
