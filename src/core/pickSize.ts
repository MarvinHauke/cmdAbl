// Height of the pick dialog. The numbers mirror the layout of ui/pick.html:
// title + footer chrome, one row per item, and one extra line for the command
// preview when the request carries one. Change them together with the page.

export const PICK_BASE_HEIGHT = 120;
export const PICK_ROW_HEIGHT = 28;
export const PICK_PREVIEW_HEIGHT = 28;
/**
 * Largest dialog height. Assumption: a 13" laptop screen offers at least
 * 1280×800 CSS pixels, about 700 of them usable once the menu bar and the dock
 * are out; 640 leaves room for Live's own window chrome. That is about 18 rows
 * (it was 420, about 10). Beyond it the page scrolls its list.
 */
export const PICK_MAX_HEIGHT = 640;

/** Width: the fixed 560 grows with the longest label and detail, up to a width that still fits 1280. */
export const PICK_MIN_WIDTH = 560;
export const PICK_MAX_WIDTH = 880;
/** Characters of the 13 px list font, measured like notifySize's (8.05 px); the detail is 11 px. */
export const PICK_LABEL_CHAR_WIDTH = 8.05;
export const PICK_DETAIL_CHAR_WIDTH = 6.6;
/** Padding, the mark and state columns, the gap between label and detail, a scrollbar. */
export const PICK_WIDTH_CHROME = 110;

export function pickHeight(itemCount: number, hasPreview: boolean): number {
  const height = PICK_BASE_HEIGHT + itemCount * PICK_ROW_HEIGHT + (hasPreview ? PICK_PREVIEW_HEIGHT : 0);
  return Math.min(height, PICK_MAX_HEIGHT);
}

/** The width for the longest label and detail (in characters), clamped to what fits a laptop screen. */
export function pickWidth(longestLabel: number, longestDetail: number): number {
  const wanted = Math.ceil(longestLabel * PICK_LABEL_CHAR_WIDTH + longestDetail * PICK_DETAIL_CHAR_WIDTH) + PICK_WIDTH_CHROME;
  return Math.min(Math.max(wanted, PICK_MIN_WIDTH), PICK_MAX_WIDTH);
}
