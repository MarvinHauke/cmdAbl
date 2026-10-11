// Height of the pick dialog. The numbers mirror the layout of ui/pick.html:
// title + footer chrome, one row per item, and one extra line for the command
// preview when the request carries one. Change them together with the page.

export const PICK_BASE_HEIGHT = 120;
export const PICK_ROW_HEIGHT = 28;
export const PICK_PREVIEW_HEIGHT = 28;
export const PICK_MAX_HEIGHT = 420;

export function pickHeight(itemCount: number, hasPreview: boolean): number {
  const height = PICK_BASE_HEIGHT + itemCount * PICK_ROW_HEIGHT + (hasPreview ? PICK_PREVIEW_HEIGHT : 0);
  return Math.min(height, PICK_MAX_HEIGHT);
}
