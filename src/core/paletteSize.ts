import type { Above } from "./settings.js";

// The palette's dialog size (plan 0006, "Layout without jumping"). The size is fixed when the
// dialog opens, so with a hint panel or the option rows above the prompt the dialog opens taller:
// the reserved area above the prompt grows, and at least five target rows stay visible below.

export const PALETTE_WIDTH = 500;
export const PALETTE_BASE_HEIGHT = 260;
/** Extra height for the area above the prompt, by `palette.above`. */
export const PALETTE_ABOVE_EXTRA: Readonly<Record<Above, number>> = { off: 0, hints: 100, options: 150 };

/** The height in px: 260 (off), 360 (hints), 410 (options). Anything else counts as off. */
export function paletteHeight(above: string | undefined): number {
  const extra = (PALETTE_ABOVE_EXTRA as Record<string, number | undefined>)[above ?? "off"];
  return PALETTE_BASE_HEIGHT + (typeof extra === "number" ? extra : 0);
}
