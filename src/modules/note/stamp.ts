/**
 * Pure helpers of the note stamp flow (plan 0013, "Stamps"): the heading and the page's answer. The loop while
 * writing is the `loop` module (plan 0026). The flow itself is in command.ts.
 */

/** The part of the transport the stamp heading reads (structurally what `api.set.transport()` answers). */
export interface StampTransport {
  playing: boolean;
  /** Live's bar.beat.sixteenth.tick, e.g. "12.3.1.1". */
  pos: string;
}

/** What the page is told in stamp mode. */
export interface StampInfo {
  heading: string;
  hint?: string;
}

export const NO_POSITION_HINT = "no song position: Remote Script not running";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local `YYYY-MM-DD HH:MM`. Keep in step with dateHeading() in ui/modules/note/note.html. */
export function formatStampTime(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** "12.3.1.1" → "12.3.1"; null when the text is not a position. */
export function trimPosition(pos: string): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(pos.trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/**
 * The heading of a stamp: `### @12.3.1 · 2026-11-11 14:32` while the song plays, the date alone when it is
 * stopped, and the date alone plus a hint when there is no transport at all (no Remote Script).
 */
export function buildStamp(transport: StampTransport | null, now: Date): StampInfo {
  const time = formatStampTime(now);
  if (transport === null) return { heading: `### ${time}`, hint: NO_POSITION_HINT };
  const pos = transport.playing ? trimPosition(transport.pos) : null;
  return { heading: pos === null ? `### ${time}` : `### @${pos} · ${time}` };
}

/** The page's answer: `text` null = unchanged, "" = cleared; `then` = what follows the save: "stamp" (s), "view" (Esc in stamp edit). */
export type PageThen = "stamp" | "view" | null;

export interface PageAnswer {
  text: string | null;
  then: PageThen;
  /** The answer was not the expected JSON (a broken page): treated as unchanged, but worth a log line. */
  unreadable?: true;
}

/** Parse what the note page returned when it closed. Anything unreadable counts as "unchanged, nothing more". */
export function parseAnswer(raw: string | null): PageAnswer {
  if (!raw) return { text: null, then: null };
  const bad: PageAnswer = { text: null, then: null, unreadable: true };
  try {
    const v = JSON.parse(raw) as { text?: unknown; then?: unknown } | null;
    if (v === null || typeof v !== "object") return bad;
    return { text: typeof v.text === "string" ? v.text : null, then: v.then === "stamp" || v.then === "view" ? v.then : null };
  } catch {
    return bad;
  }
}
