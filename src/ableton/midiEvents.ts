import * as crypto from "node:crypto";
import type * as http from "node:http";
import type { Logger } from "../core/log.js";
import { fromBrowserPage } from "../httpTrigger.js";
import type { MidiControl, MidiControls, MidiEvent } from "./midiLink.js";

// Development helpers for the MIDI push (plan 0018): a debug line per event with its latency, and
// `POST /midi-listen` to change what the script forwards without a command. Both are wired in
// extension.ts for development builds only (like the routes of plan 0016).

/** One debug line: the event and how long the push took (`Date.now() - time`, the script's clock is this machine's). */
export function logMidiEvent(log: Pick<Logger, "debug">, event: MidiEvent, now: number = Date.now()): void {
  try {
    const ms = Math.round((now - event.time) * 10) / 10;
    log.debug(`${event.type} ch${event.channel} #${event.number} = ${event.value} seq ${event.seq} latency ${ms} ms`);
  } catch {
    // logging must never take the host down
  }
}

/**
 * `CC37,CC38/ch2,N60,PB` -> controls. `CC` or `N` alone is every number, `/chN` limits the channel.
 * Returns null for anything it does not understand.
 */
export function parseControlList(text: string): MidiControl[] | null {
  const out: MidiControl[] = [];
  for (const raw of text.split(",")) {
    const m = /^(cc|n|pb)(\d{1,3})?(?:\/ch(\d{1,2}))?$/i.exec(raw.trim());
    if (!m) return null;
    const kind = m[1]!.toLowerCase();
    const control: MidiControl = { type: kind === "n" ? "note" : kind === "pb" ? "pb" : "cc" };
    if (m[2] !== undefined) {
      if (kind === "pb") return null;
      control.number = Number(m[2]);
      if (control.number > 127) return null;
    }
    if (m[3] !== undefined) {
      control.channel = Number(m[3]);
      if (control.channel < 1 || control.channel > 16) return null;
    }
    out.push(control);
  }
  return out.length > 0 ? out : null;
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface MidiListenRouteDeps {
  /** The development-routes token. */
  token: string;
  /** Run midi_listen; resolves to a one-line answer. */
  listen: (controls: MidiControls, monitor: boolean) => Promise<string>;
}

/**
 * `POST /midi-listen?controls=all|none|CC37,CC38/ch2,N60,PB[&monitor=1]` (Bearer = the development token).
 * Same shape as the trigger server's `extra` hook: true when the request was handled. Never throws.
 */
export function createMidiListenRoute(deps: MidiListenRouteDeps): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const text = (res: http.ServerResponse, status: number, body: string, headers: http.OutgoingHttpHeaders = {}): void => {
    res.writeHead(status, headers).end(body);
  };
  return (req, res) => {
    const url = (req.url ?? "/").split("#")[0] ?? "/";
    const at = url.indexOf("?");
    if ((at < 0 ? url : url.slice(0, at)) !== "/midi-listen") return false;
    const query = at < 0 ? "" : url.slice(at + 1);
    try {
      const header = req.headers.authorization;
      const given = typeof header === "string" ? /^Bearer (.+)$/.exec(header)?.[1] : undefined;
      if (req.method !== "POST") text(res, 405, "", { Allow: "POST" });
      else if (fromBrowserPage(req)) text(res, 403, "forbidden");
      else if (given === undefined || !sameToken(given, deps.token)) text(res, 401, "unauthorized");
      else {
        const asked = /(?:^|&)controls=([^&]*)/.exec(query)?.[1] ?? "";
        const controls = asked === "all" || asked === "none" ? asked : parseControlList(asked);
        if (controls === null) text(res, 400, "controls=all | none | CC37,CC38/ch2,N60,PB  [&monitor=1]");
        else {
          const monitor = /(?:^|&)monitor=1(?:&|$)/.test(query);
          deps.listen(controls, monitor).then(
            (line) => text(res, 200, line),
            () => text(res, 500, "internal error"),
          );
        }
      }
    } catch {
      try {
        text(res, 500, "internal error");
      } catch {
        // the response is already gone
      }
    }
    return true;
  };
}
