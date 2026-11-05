import type { Above } from "../settings/settings.js";

// The palette's dialog size (plan 0006, "Layout without jumping"). The size is fixed when the
// dialog opens, so with a hint panel or the option rows above the prompt the dialog opens taller:
// the reserved area above the prompt grows, and at least five target rows stay visible below.

export const PALETTE_WIDTH = 500;
export const PALETTE_BASE_HEIGHT = 260;
/** The help footer every palette has (plan 0019 §4): 28 text + 8 padding + 1 border; the prompt and rows keep their space. */
export const PALETTE_FOOTER_HEIGHT = 37;
/** Extra height for the area above the prompt, by `palette.above`. */
export const PALETTE_ABOVE_EXTRA: Readonly<Record<Above, number>> = { off: 0, hints: 160, options: 190 };

/** The height in px: 297 (off), 457 (hints), 487 (options): base 260 + the footer 37 + the area above. Anything else counts as off. */
export function paletteHeight(above: string | undefined): number {
  const extra = (PALETTE_ABOVE_EXTRA as Record<string, number | undefined>)[above ?? "off"];
  return PALETTE_BASE_HEIGHT + PALETTE_FOOTER_HEIGHT + (typeof extra === "number" ? extra : 0);
}
