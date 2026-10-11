// Size of the message dialog, from its text. The numbers were measured on
// ui/feedback.html (headless Chrome, not Live's webview): 18 px per line,
// 65 px of fixed height around the text, about 7.83 px per character, and a
// text width of window width − 32 px. Change them together with the page.

export const NOTIFY_LINE_HEIGHT = 18;
export const NOTIFY_FIXED_HEIGHT = 65;
export const NOTIFY_CHAR_WIDTH = 7.83;
export const NOTIFY_HORIZONTAL_CHROME = 32;
/** Extra width so the longest line does not sit exactly on the edge. */
export const NOTIFY_WIDTH_MARGIN = 8;
export const NOTIFY_MIN_WIDTH = 500;
export const NOTIFY_MAX_WIDTH = 760;
export const NOTIFY_MIN_HEIGHT = 110;
export const NOTIFY_MAX_HEIGHT = 420;

/** Characters that fit on one line at this window width (the margin is kept free). */
export function notifyCharsPerLine(width: number): number {
  return Math.max(1, Math.floor((width - NOTIFY_HORIZONTAL_CHROME - NOTIFY_WIDTH_MARGIN) / NOTIFY_CHAR_WIDTH));
}

export function notifySize(text: string): { width: number; height: number } {
  const lines = text.split("\n");
  const longest = lines.reduce((max, l) => Math.max(max, l.length), 0); // no spread: a huge text must not throw
  const wanted = Math.ceil(longest * NOTIFY_CHAR_WIDTH) + NOTIFY_HORIZONTAL_CHROME + NOTIFY_WIDTH_MARGIN;
  const width = Math.min(Math.max(wanted, NOTIFY_MIN_WIDTH), NOTIFY_MAX_WIDTH);

  // Lines longer than the window wrap. Word wrapping can need a line more than
  // this count, and characters wider than one cell (CJK, emoji, a fallback font
  // for the check marks) count as one; the page absorbs both by scrolling.
  const perLine = notifyCharsPerLine(width);
  const rows = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0);
  const height = Math.min(Math.max(NOTIFY_FIXED_HEIGHT + NOTIFY_LINE_HEIGHT * rows, NOTIFY_MIN_HEIGHT), NOTIFY_MAX_HEIGHT);
  return { width, height };
}
