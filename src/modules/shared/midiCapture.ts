import type { MidiMessage } from "../../ableton/bridgeOps.js";
import { fail, type CommandResult } from "../../core/types.js";
import type { ModuleApi } from "../types.js";

// "Move a control, then press Enter" (plan 0018): shared by `map learn` and `midi monitor`. The page is ui/modules/midi/capture.html (a
// live page); it answers "go" on Enter (in learn mode also when the first control moved) and "" on Esc. While it is open the script keeps
// every message (a monitor window); after it closes the module asks `api.midi.last` for what came in.

import { fillTemplate } from "../../core/surfaces/inlineJson.js";

export type CaptureMode = "learn" | "monitor";

/** The capture page filled in: `title` and `hint` are plain text; `mode` tells a live page whether to close itself on the first control. */
export const capturePage = (title: string, hint: string, mode: CaptureMode = "monitor", template: string): string =>
  fillTemplate(template, { CAPTURE: { title, hint, mode } });

export interface Captured {
  /** Enter was pressed (false: Esc or dismissed). */
  done: boolean;
  /** The page had no live view (it answered "list"): the command should show what came in. */
  fallback: boolean;
  /** What came in while the page was open, oldest first. */
  messages: MidiMessage[];
}

/** The window lasts this long at most (the script allows 1-120 s). */
export const CAPTURE_SECONDS = 120;

/** The newest messages the live page shows, and how often the fallback poll behind its route runs. */
const LIVE_ROWS = 20;
const KEPT_ROWS = 50;
const POLL_MS = 500; // the fallback poll; pushed events arrive at once

/**
 * Open the capture page (a live page: it polls the `messages` route, and closes itself in learn mode on the first control that
 * moved) and collect the MIDI messages that arrive while it is open. A failure of the Remote Script comes back as a result
 * (exit 5). The monitor window is closed again before this returns, whatever happened; the caller's own `setBindings`
 * call also ends it. `template` is the page (ui/modules/midi/capture.html), given by the module's index.ts.
 */
export async function captureMessages(
  api: ModuleApi,
  title: string,
  hint: string,
  name: string,
  mode: CaptureMode,
  template: string,
): Promise<Captured | CommandResult> {
  const start = await api.midi.last(0);
  if (!start.ok) return fail(start.code, `${name}: ${start.text}`);
  const opened = await api.midi.listen("all", { monitor: true, seconds: CAPTURE_SECONDS });
  if (!opened.ok) return fail(opened.code, `${name}: ${opened.text}`);
  const since = start.value.last;
  const openedAt = Date.now();
  // The route must answer within the platform's ~100 ms: it returns a cache. The cache is fed by the script's pushed monitor
  // events (a few ms after the message); a slow poll of midi_last fills the start and covers a push that gets lost.
  const seen = new Map<number, MidiMessage>();
  let lastSeq = since;
  let cache: Record<string, unknown> = { opened: openedAt, last: since, messages: [] };
  // Waiting requests of the page (long polling): each is asked after a publish (forced = the blocked list changed).
  const waiters = new Set<(forced: boolean) => void>();
  const wake = (forced: boolean): void => {
    for (const waiter of [...waiters]) waiter(forced);
  };
  const publish = (): void => {
    const rows = [...seen.values()].sort((a, b) => a.seq - b.seq);
    for (const old of rows.slice(0, Math.max(0, rows.length - KEPT_ROWS))) seen.delete(old.seq);
    const shown = rows.slice(-LIVE_ROWS);
    lastSeq = shown.at(-1)?.seq ?? since;
    cache = { opened: openedAt, last: lastSeq, messages: shown };
    wake(false);
  };
  /** What the page gets: the messages, and the controls Live refused to forward during the window (null = unknown). */
  const current = (): unknown => ("error" in cache ? cache : { ...cache, blocked: api.midi.blocked() });
  const take = (message: MidiMessage): void => {
    if (message.seq > since) seen.set(message.seq, message);
  };
  const refresh = async (): Promise<void> => {
    try {
      const got = await api.midi.last(since);
      if (got.ok) {
        for (const message of got.value.messages) take(message);
        publish();
      } else if (seen.size === 0) cache = { error: got.text };
    } catch {
      if (seen.size === 0) cache = { error: "no answer" }; // last() never throws; a refresh must not take the command down if it ever does
    }
  };
  await refresh();
  const off = api.midi.onEvent((event) => {
    if (event.monitor !== true) return;
    take({ seq: event.seq, type: event.type, channel: event.channel, number: event.number, value: event.value, time: event.time });
    publish();
  });
  const offBlocked = api.midi.onBlocked(() => wake(true));
  let running = true;
  let stopSleep: () => void = () => {};
  const loop = (async () => {
    while (running) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, POLL_MS);
        stopSleep = () => (clearTimeout(timer), resolve()); // closing the page ends the sleep at once
      });
      if (running) await refresh();
    }
  })();
  /** The waiting route: answers at once for the first request (no `since`), else when a message newer than `since` arrived (core caps the wait at 1 s). */
  const waitForNewer = (sinceSeen: number | null, cancel: { onCancel(callback: () => void): void }): Promise<unknown> =>
    new Promise((resolve) => {
      if (sinceSeen === null || lastSeq > sinceSeen || "error" in cache) return resolve(current());
      const waiter = (forced: boolean): void => {
        if (!forced && lastSeq <= sinceSeen) return;
        waiters.delete(waiter);
        resolve(current());
      };
      waiters.add(waiter);
      cancel.onCancel(() => waiters.delete(waiter));
    });
  let answer: string | null;
  try {
    answer = await api.ui.livePage(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), capturePage(title, hint, mode, template), 460, 320, { messages: { wait: waitForNewer } });
  } finally {
    running = false;
    stopSleep();
    off();
    offBlocked();
    await loop;
  }
  const got = await api.midi.last(since);
  await api.midi.listen("none"); // ends the monitor window; the bound controls stay forwarded
  if (!got.ok) return fail(got.code, `${name}: ${got.text}`);
  return { done: answer === "go" || answer === "list", fallback: answer === "list", messages: got.value.messages };
}

/** Narrow the union: a captured window or a failure result. */
export const isCaptured = (value: Captured | CommandResult): value is Captured => "messages" in value;
