import type { MidiMessage } from "../ableton/bridgeOps.js";
import { fail, type CommandResult } from "../core/types.js";
import type { ModuleApi } from "./types.js";

// "Move a control, then press Enter" (plan 0018): shared by `map learn` and `midi monitor`. The page is ui/modules/midi/capture.html (a
// live page); it answers "go" on Enter (in learn mode also when the first control moved) and "" on Esc. While it is open the script keeps
// every message (a monitor window); after it closes the module asks `api.midi.last` for what came in.

import { fillTemplate } from "../core/inlineJson.js";

export type CaptureMode = "learn" | "monitor";

/** The capture page filled in: `title` and `hint` are plain text; `mode` tells a live page whether to close itself on the first control. */
export const capturePage = (title: string, hint: string, mode: CaptureMode = "monitor", template: string): string =>
  fillTemplate(template, { CAPTURE: { title, hint, mode } });

export interface Captured {
  /** Enter was pressed (false: Esc or dismissed). */
  done: boolean;
  /** What came in while the page was open, oldest first. */
  messages: MidiMessage[];
}

/** The window lasts this long at most (the script allows 1-120 s). */
export const CAPTURE_SECONDS = 120;

/** The newest messages the live page shows, and how often the cache behind its route is refreshed. */
const LIVE_ROWS = 20;
const POLL_MS = 100;

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
  // The route must answer within the platform's ~100 ms: it returns a cache that a loop keeps fresh (the bridge call can be slower).
  let cache: unknown = { opened: openedAt, last: since, messages: [] };
  const refresh = async (): Promise<void> => {
    try {
      const got = await api.midi.last(since);
      cache = got.ok ? { opened: openedAt, last: got.value.last, messages: got.value.messages.slice(-LIVE_ROWS) } : { error: got.text };
    } catch {
      cache = { error: "no answer" }; // last() never throws; a refresh must not take the command down if it ever does
    }
  };
  await refresh();
  let running = true;
  const loop = (async () => {
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (running) await refresh();
    }
  })();
  let answer: string | null;
  try {
    answer = await api.ui.livePage(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), capturePage(title, hint, mode, template), 460, 320, { messages: () => cache });
  } finally {
    running = false;
    await loop;
  }
  const got = await api.midi.last(since);
  await api.midi.listen("none"); // ends the monitor window; the bound controls stay forwarded
  if (!got.ok) return fail(got.code, `${name}: ${got.text}`);
  return { done: answer === "go", messages: got.value.messages };
}

/** Narrow the union: a captured window or a failure result. */
export const isCaptured = (value: Captured | CommandResult): value is Captured => "messages" in value;
