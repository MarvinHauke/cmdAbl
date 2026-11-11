// The palette's dialog size (plan 0006, "Layout without jumping"; plan 0019 §4). The size is fixed when the
// dialog opens. There is no area above the prompt any more: the rows list the options and the footer explains.

export const PALETTE_WIDTH = 500;
export const PALETTE_BASE_HEIGHT = 260;
/** The help footer every palette has (plan 0019 §4): 42 text (three 14 px lines, or a line and a key-cap row) + 8 padding + 1 border; the prompt and rows keep their space. */
export const PALETTE_FOOTER_HEIGHT = 51;

/** The height in px: 311 = base 260 + the footer 51. */
export const PALETTE_HEIGHT = PALETTE_BASE_HEIGHT + PALETTE_FOOTER_HEIGHT;
