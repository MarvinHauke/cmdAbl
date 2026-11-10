import { itemText, type ResultSection, type StatusItem } from "../types.js";

// Size of the message dialog, from its text. The numbers are those of
// ui/feedback.html in Live's webview (measured in Live 12.4.15b6 on
// 2026-10-11; headless Chrome had said 7.83 px per character, which made
// the longest line wrap): 18 px per line, about 66.5 px of fixed content height
// around the text (the requested height is the content height, the title band
// is extra), about 8.05 px per character, and a text width of window width −
// 32 px. Change them together with the page.

export const NOTIFY_LINE_HEIGHT = 18;
/**
 * Content height around the text: padding, gap and button. About 66.5 px in
 * Live 12.4.15b6 (measured 2026-10-11; headless Chrome gave 65), plus a margin
 * so a text that fits never lands within a pixel of overflowing — a scrollbar
 * takes width, wraps the longest line and hides the last one.
 */
export const NOTIFY_FIXED_HEIGHT = 72;
export const NOTIFY_CHAR_WIDTH = 8.05;
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
  let rows = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0);
  // Where a line wraps the estimate can be off by one: leave a line of slack.
  // Unwrapped text stays tight.
  if (lines.some((l) => l.length > perLine)) rows += 1;
  const height = Math.min(Math.max(NOTIFY_FIXED_HEIGHT + NOTIFY_LINE_HEIGHT * rows, NOTIFY_MIN_HEIGHT), NOTIFY_MAX_HEIGHT);
  return { width, height };
}

/** The lines a sections view takes (heading with meta, indented items, a blank line between), for sizing the dialog. */
export function sectionsText(sections: Array<{ heading: string; meta?: string; items: Array<string | StatusItem> }>): string {
  return sections
    .map((s) => [s.meta ? `${s.heading}  ${s.meta}` : s.heading, ...s.items.map((i) => `  ${itemLine(i)}`)].join("\n"))
    .join("\n\n");
}

/** A row's line for sizing: a status mark and a button take room before and after the text. */
function itemLine(item: string | StatusItem): string {
  if (typeof item === "string") return item;
  return `${item.status ? "✓ " : ""}${itemText(item)}${item.action ? `  [${item.action.label}]` : ""}`;
}

// ── sections with status rows (plan 0021) ────────────────────────────────────
// ui/feedback.html lays these out in boxes, so the height is the sum of the boxes (css values of the page):
// body padding 16 + 16, a 12 px gap between msg, help line and footer; per section a 18 px heading, a 5 px
// margin and rows of at least 24 px (32 with a button) with a 4 px gap; between sections 10 + 1 + 10; the help line is 36 px and
// there only when a row has a button or there is a checkbox; the footer is one 24 px line.

const NOTIFY_HELP_LINE_HEIGHT = 36;
const SEC_PAGE_PADDING = 32;
const SEC_GAP = 12;
const SEC_HEAD = NOTIFY_LINE_HEIGHT;
const SEC_ITEMS_MARGIN = 5;
const SEC_ROW_MIN = 24;
const SEC_ROW_BUTTON = 32; // measured: a row with a button
const SEC_ROW_PAD = 6; // vertical padding of a wrapped row (2 + 2 + a line of slack)
const SEC_ROW_GAP = 4;
const SEC_SEPARATOR = 21;
const SEC_FOOTER = 24;
const SEC_SLACK = 8;
/** Width taken by the row's mark, its gaps and the item indent; a button adds its label and 24 px. */
const SEC_ROW_CHROME = 16 + 12 + 8 + 14;

export function sectionsSize(sections: ResultSection[], options: { toggle: boolean }): { width: number; height: number } {
  const rowText = (i: string | StatusItem) => (typeof i === "string" ? i : i.text);
  const buttonWidth = (i: string | StatusItem) => (typeof i === "string" || !i.action ? 0 : Math.ceil(i.action.label.length * NOTIFY_CHAR_WIDTH) + 24 + 8);
  const rowWidth = (i: string | StatusItem) => Math.ceil(rowText(i).length * NOTIFY_CHAR_WIDTH) + SEC_ROW_CHROME + buttonWidth(i);
  let wanted = 0;
  for (const s of sections) {
    wanted = Math.max(wanted, Math.ceil((s.meta ? `${s.heading}  ${s.meta}` : s.heading).length * NOTIFY_CHAR_WIDTH));
    for (const i of s.items) wanted = Math.max(wanted, rowWidth(i));
  }
  const width = Math.min(Math.max(wanted + NOTIFY_HORIZONTAL_CHROME + NOTIFY_WIDTH_MARGIN, NOTIFY_MIN_WIDTH), NOTIFY_MAX_WIDTH);
  const room = width - NOTIFY_HORIZONTAL_CHROME - NOTIFY_WIDTH_MARGIN;
  let body = 0;
  sections.forEach((s, n) => {
    body += (n > 0 ? SEC_SEPARATOR : 0) + SEC_HEAD + SEC_ITEMS_MARGIN;
    s.items.forEach((i, k) => {
      const perLine = Math.max(1, Math.floor((room - SEC_ROW_CHROME - buttonWidth(i)) / NOTIFY_CHAR_WIDTH));
      const lines = Math.max(1, Math.ceil(rowText(i).length / perLine));
      body += (k > 0 ? SEC_ROW_GAP : 0) + Math.max(buttonWidth(i) > 0 ? SEC_ROW_BUTTON : SEC_ROW_MIN, lines * NOTIFY_LINE_HEIGHT + SEC_ROW_PAD);
    });
  });
  const help = options.toggle || sections.some((s) => s.items.some((i) => typeof i !== "string" && i.action));
  const height = SEC_PAGE_PADDING + body + (help ? SEC_GAP + NOTIFY_HELP_LINE_HEIGHT : 0) + SEC_GAP + SEC_FOOTER + SEC_SLACK;
  return { width, height: Math.min(Math.max(height, NOTIFY_MIN_HEIGHT), 640) };
}

/**
 * True when the page lays the sections out as status rows (an object item) or with a checkbox. Plain-string items in such a
 * page are estimated as full rows, so a mixed page is sized high (cmdAbl sends status rows only in the setup page).
 */
export function usesStatusLayout(sections: ResultSection[] | undefined, toggle: boolean): boolean {
  return toggle || (sections?.some((s) => s.items.some((i) => typeof i !== "string")) ?? false);
}
