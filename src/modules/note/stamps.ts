import { comparePos, parsePos, type BarPosition } from "../shared/position.js";

/** One stamp heading of the note file (`### @12.3.1 · 2026-11-11 14:32`, or the date alone). */
export interface ParsedStamp {
  heading: string;
  /** Null for a stamp made while stopped (date only). */
  position: BarPosition | null;
  /** The first words of the text below the heading ("" when empty). */
  preview: string;
}

const POSITIONED = /^###\s+@(\d+\.\d+\.\d+)\s*·\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?\s*$/;
const DATE_ONLY = /^###\s+\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?\s*$/;
const PREVIEW_WORDS = 8;

/** Read the stamp headings of a note (code fences are skipped; other `###` headings are not stamps). */
export function parseStamps(text: string): ParsedStamp[] {
  const stamps: ParsedStamp[] = [];
  let fence = false;
  let body: string[] = [];
  const close = (): void => {
    const last = stamps[stamps.length - 1];
    if (last) last.preview = body.join(" ").replace(/[*_`]/g, "").split(/\s+/).filter(Boolean).slice(0, PREVIEW_WORDS).join(" ");
    body = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence;
    else if (!fence && /^#{1,6}\s/.test(raw)) {
      close();
      const line = raw.trimEnd();
      const p = POSITIONED.exec(line);
      if (p) {
        const position = parsePos(p[1] ?? "");
        if (position && position.bar >= 1 && position.beat >= 1 && position.six >= 1) stamps.push({ heading: line, position, preview: "" });
      } else if (DATE_ONLY.test(line)) stamps.push({ heading: line, position: null, preview: "" });
      continue;
    }
    if (stamps.length > 0) body.push(raw.replace(/^[\s>*#\-\[\]x]+/i, ""));
  }
  close();
  return stamps;
}

/** The stamp with a position, sorted by it (stable). */
export function positioned(stamps: ParsedStamp[]): (ParsedStamp & { position: BarPosition })[] {
  return stamps
    .filter((s): s is ParsedStamp & { position: BarPosition } => s.position !== null)
    .sort((a, b) => comparePos(a.position, b.position));
}

/** The first stamp strictly after `from`; with `wrap`, the first one overall when there is none after. */
export function nextStamp(stamps: ParsedStamp[], from: BarPosition, wrap: boolean): ParsedStamp | null {
  const list = positioned(stamps);
  return list.find((s) => comparePos(s.position, from) > 0) ?? (wrap ? (list[0] ?? null) : null);
}

/** The last stamp strictly before `from`; with `wrap`, the last one overall when there is none before. */
export function prevStamp(stamps: ParsedStamp[], from: BarPosition, wrap: boolean): ParsedStamp | null {
  const list = positioned(stamps);
  const before = list.filter((s) => comparePos(s.position, from) < 0);
  return before[before.length - 1] ?? (wrap ? (list[list.length - 1] ?? null) : null);
}

/** Index in `stamps` (as listed) of the cursor row: the next stamp after `from`, else the first positioned one, else 0. */
export function listCursor(stamps: ParsedStamp[], from: BarPosition | null): number {
  const idx = (s: ParsedStamp | undefined): number => (s ? stamps.indexOf(s) : -1);
  if (from !== null) {
    const n = stamps.filter((s) => s.position !== null && comparePos(s.position, from) > 0).sort((a, b) => comparePos(a.position!, b.position!))[0];
    if (idx(n) >= 0) return idx(n);
  }
  const first = idx(stamps.find((s) => s.position !== null));
  return first >= 0 ? first : 0;
}

/** "12.3.1" for a position. */
export const formatPos = (p: BarPosition): string => `${p.bar}.${p.beat}.${p.six}`;
