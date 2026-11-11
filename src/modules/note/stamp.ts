/**
 * Pure helpers of the note stamp flow (plan 0013, "Stamps"): the heading, the loop to set and when to put the
 * old loop back, and the page's answer. The flow itself is in command.ts.
 */

/** A loop as the Remote Script reports it; times in beats. */
export interface StampLoop {
  on: boolean;
  start: number;
  length: number;
}

/** The part of the transport the stamp flow reads (structurally what `api.set.transport()` answers). */
export interface StampTransport {
  playing: boolean;
  /** Any track plays a session clip. */
  session: boolean;
  /** Live's bar.beat.sixteenth.tick, e.g. "12.3.1.1". */
  pos: string;
  barStart: number;
  barLen: number;
  loop: StampLoop;
}

/** What the page is told in stamp mode. */
export interface StampInfo {
  heading: string;
  hint?: string;
}

export const NO_POSITION_HINT = "no song position: Remote Script not running";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local `YYYY-MM-DD HH:MM`. */
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

/** The loop to set for a stamp, or null when the loop is left alone (setting off, stopped, or Session playback). */
export function loopForStamp(transport: StampTransport | null, stampLoop: boolean, loopBars: number): StampLoop | null {
  if (!stampLoop || transport === null || !transport.playing || transport.session) return null;
  if (!(transport.barLen > 0) || !(loopBars > 0)) return null;
  return { on: true, start: transport.barStart, length: loopBars * transport.barLen };
}

const EPSILON = 1e-3;

/** True when two loops are the same (beats, small tolerance for what Live rounds). */
export function sameLoop(a: StampLoop, b: StampLoop): boolean {
  return a.on === b.on && Math.abs(a.start - b.start) < EPSILON && Math.abs(a.length - b.length) < EPSILON;
}

/** Put the old loop back only if nobody moved the one we set. */
export function shouldRestoreLoop(current: StampLoop | null, set: StampLoop): boolean {
  return current !== null && sameLoop(current, set);
}

/** The page's answer: `text` null = unchanged, "" = cleared; `then` "stamp" = the user pressed m in view. */
export interface PageAnswer {
  text: string | null;
  then: "stamp" | null;
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
    return { text: typeof v.text === "string" ? v.text : null, then: v.then === "stamp" ? "stamp" : null };
  } catch {
    return bad;
  }
}
