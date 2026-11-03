import type { MidiMessage } from "../ableton/bridgeOps.js";
import { fail, type CommandResult } from "../core/types.js";
import type { ModuleApi } from "./types.js";

// "Move a control, then press Enter" (plan 0018): shared by `map learn` and `midi monitor`. The page is a
// small self-contained dialog; it answers "go" on Enter and "" on Esc. While it is open the script keeps
// every message (a monitor window); after it closes the module asks `api.midi.last` for what came in.

import { fillTemplate } from "../core/inlineJson.js";

const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>MIDI</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { background: #1e1e1e; color: #ddd; font: 13px -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 0 18px; }
  h1 { font-size: 14px; margin: 0; font-weight: 600; }
  p { margin: 0; color: #999; overflow-wrap: anywhere; }
  kbd { background: #333; border-radius: 3px; padding: 1px 6px; color: #ddd; }
</style></head><body>
<h1 id="title"></h1><p id="hint"></p><p><kbd>Enter</kbd> done &nbsp; <kbd>Esc</kbd> cancel</p>
<script>
  // In: CAPTURE_PLACEHOLDER = { title, hint } (plain text, set with textContent). Out (close_and_send): "go" on Enter, "" on Esc.
  const CAPTURE = /*CAPTURE_PLACEHOLDER*/null;
  document.getElementById('title').textContent = CAPTURE.title;
  document.getElementById('hint').textContent = CAPTURE.hint;
  function send(value) {
    const m = { method: 'close_and_send', params: [value] };
    if (window.webkit?.messageHandlers?.live) window.webkit.messageHandlers.live.postMessage(m);
    else if (window.chrome?.webview) window.chrome.webview.postMessage(m);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send('go'); }
    else if (e.key === 'Escape') { e.preventDefault(); send(''); }
  });
</script></body></html>`;

/** The capture dialog's page: `title` and `hint` are plain text. */
export const capturePage = (title: string, hint: string): string => fillTemplate(PAGE, { CAPTURE: { title, hint } });

export interface Captured {
  /** Enter was pressed (false: Esc or dismissed). */
  done: boolean;
  /** What came in while the page was open, oldest first. */
  messages: MidiMessage[];
}

/** The window lasts this long at most (the script allows 1-120 s). */
export const CAPTURE_SECONDS = 120;

/**
 * Open the capture page and collect the MIDI messages that arrive while it is open. A failure of the Remote Script
 * comes back as a result (exit 5). The monitor window is closed again before this returns, whatever happened;
 * the caller's own `setBindings` call also ends it.
 */
export async function captureMessages(api: ModuleApi, title: string, hint: string, name: string): Promise<Captured | CommandResult> {
  const start = await api.midi.last(0);
  if (!start.ok) return fail(start.code, `${name}: ${start.text}`);
  const opened = await api.midi.listen("all", { monitor: true, seconds: CAPTURE_SECONDS });
  if (!opened.ok) return fail(opened.code, `${name}: ${opened.text}`);
  const answer = await api.dialog(capturePage(title, hint), 420, 190, name);
  const got = await api.midi.last(start.value.last);
  await api.midi.listen("none"); // ends the monitor window; the bound controls stay forwarded
  if (!got.ok) return fail(got.code, `${name}: ${got.text}`);
  return { done: answer === "go", messages: got.value.messages };
}

/** Narrow the union: a captured window or a failure result. */
export const isCaptured = (value: Captured | CommandResult): value is Captured => "messages" in value;
