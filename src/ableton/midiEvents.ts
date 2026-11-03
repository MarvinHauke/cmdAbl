import * as crypto from "node:crypto";
import type * as http from "node:http";
import { logger, type Logger } from "../core/log.js";
import { fromBrowserPage } from "../httpTrigger.js";
import type { MidiControl } from "./bridgeOps.js";

// MIDI events pushed by the Remote Script (plan 0018, spike). The script sends each event on
// three channels (`via`: udp, udp_tick, http); this file receives them, logs each one and keeps
// the latency (`Date.now() - t`, both clocks are this machine's) per channel. Spike only: no
// command runs yet. `POST /midi-event` (the http channel) and `POST /midi-listen` exist in
// development builds only (extension.ts), like the routes of plan 0016.

export const SUMMARY_EVERY = 50;
export const MAX_EVENT_BODY = 2 * 1024;

export interface MidiEvent {
  via: string;
  seq: number;
  type: string;
  channel: number;
  number: number;
  value: number;
  /** When the script's receive_midi ran (ms since the epoch). */
  t: number;
  /** When the script sent this copy (ms since the epoch). */
  sent: number;
}

/** The event in a pushed message, or null when a field is missing or has the wrong type. */
export function readMidiEvent(data: Record<string, unknown>): MidiEvent | null {
  const { via, seq, type, channel, number, value, t, sent } = data;
  if (typeof via !== "string" || typeof type !== "string") return null;
  if (![seq, channel, number, value, t, sent].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { via, seq: seq as number, type, channel: channel as number, number: number as number, value: value as number, t: t as number, sent: sent as number };
}

export interface LatencyStats {
  n: number;
  min: number;
  median: number;
  max: number;
}

export function latencyStats(samples: readonly number[]): LatencyStats | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { n: sorted.length, min: sorted[0]!, median, max: sorted[sorted.length - 1]! };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const statsText = (s: LatencyStats): string => `n=${s.n} min ${round1(s.min)} median ${round1(s.median)} max ${round1(s.max)} ms`;

export interface MidiMonitor {
  /** One pushed event; `arrived` is when it reached this process (default: now). Never throws. */
  handle(data: Record<string, unknown>, arrived?: number): void;
  /** Latency of the last SUMMARY_EVERY events per channel. */
  summary(): Record<string, LatencyStats>;
}

export function createMidiMonitor(log: Pick<Logger, "debug" | "info" | "warn"> = logger("midi"), now: () => number = Date.now): MidiMonitor {
  const samples = new Map<string, number[]>();
  const counts = new Map<string, number>();
  const stats = (via: string): LatencyStats | null => latencyStats(samples.get(via) ?? []);
  return {
    handle(data, arrived = now()) {
      try {
        const e = readMidiEvent(data);
        if (!e) return void log.warn("pushed event with a missing or wrong field ignored");
        const latency = arrived - e.t;
        const held = e.sent - e.t; // time the script held this copy before sending
        const list = samples.get(e.via) ?? [];
        list.push(latency);
        if (list.length > SUMMARY_EVERY) list.shift();
        samples.set(e.via, list);
        const count = (counts.get(e.via) ?? 0) + 1;
        counts.set(e.via, count);
        log.debug(`${e.type} ch${e.channel} #${e.number} = ${e.value} via ${e.via} seq ${e.seq} latency ${round1(latency)} ms (held in the script ${round1(held)} ms)`);
        if (count % SUMMARY_EVERY === 0) {
          const s = stats(e.via);
          if (s) log.info(`latency via ${e.via}: ${statsText(s)}`);
        }
      } catch {
        // a monitor must never take the host down
      }
    },
    summary() {
      const out: Record<string, LatencyStats> = {};
      for (const via of samples.keys()) {
        const s = stats(via);
        if (s) out[via] = s;
      }
      return out;
    },
  };
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

function bearer(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer (.+)$/.exec(header) : null;
  return match ? match[1]! : null;
}

function readSmallBody(req: http.IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

export interface MidiRouteDeps {
  /** The bridge token the script posts with (read lazily from its file); null when unreadable. */
  eventToken: () => string | null;
  /** The development-routes token that guards `/midi-listen`. */
  controlToken: string;
  monitor: MidiMonitor;
  /** Run midi_listen; resolves to a one-line answer. */
  listen: (controls: "all" | "none" | MidiControl[]) => Promise<string>;
  /** The latency summary as text. */
  stats?: () => string;
}

/** Same shape as the trigger server's `extra` hook: true when the request was handled. Never throws. */
export function createMidiRoutes(deps: MidiRouteDeps): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const text = (res: http.ServerResponse, status: number, body: string, headers: http.OutgoingHttpHeaders = {}): void => {
    res.writeHead(status, headers).end(body);
  };

  async function event(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const arrived = Date.now();
    if (req.method !== "POST") return text(res, 405, "", { Allow: "POST" });
    if (fromBrowserPage(req)) return text(res, 403, "forbidden");
    const given = bearer(req);
    const expected = deps.eventToken();
    if (given === null || expected === null || !sameToken(given, expected)) return text(res, 401, "unauthorized");
    const raw = await readSmallBody(req, MAX_EVENT_BODY);
    let data: unknown;
    try {
      data = raw === null ? null : JSON.parse(raw);
    } catch {
      data = null;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return text(res, 400, "bad event");
    deps.monitor.handle(data as Record<string, unknown>, arrived);
    text(res, 200, "ok");
  }

  async function listen(req: http.IncomingMessage, res: http.ServerResponse, query: string): Promise<void> {
    if (req.method !== "POST") return text(res, 405, "", { Allow: "POST" });
    if (fromBrowserPage(req)) return text(res, 403, "forbidden");
    const given = bearer(req);
    if (given === null || !sameToken(given, deps.controlToken)) return text(res, 401, "unauthorized");
    const asked = /(?:^|&)controls=([^&]*)/.exec(query)?.[1] ?? "";
    const controls = asked === "all" || asked === "none" ? asked : parseControlList(asked);
    if (controls === null) return text(res, 400, "controls=all | none | CC37,CC38/ch2,N60,PB");
    text(res, 200, await deps.listen(controls));
  }

  return (req, res) => {
    const url = (req.url ?? "/").split("#")[0] ?? "/";
    const at = url.indexOf("?");
    const path = at < 0 ? url : url.slice(0, at);
    const query = at < 0 ? "" : url.slice(at + 1);
    if (path !== "/midi-event" && path !== "/midi-listen" && path !== "/midi-stats") return false;
    const fail = (): void => {
      try {
        text(res, 500, "internal error");
      } catch {
        // the response is already gone
      }
    };
    try {
      if (path === "/midi-stats") {
        if (req.method !== "GET") text(res, 405, "", { Allow: "GET" });
        else if (fromBrowserPage(req)) text(res, 403, "forbidden");
        else if (bearer(req) === null || !sameToken(bearer(req)!, deps.controlToken)) text(res, 401, "unauthorized");
        else text(res, 200, deps.stats?.() ?? "");
      } else if (path === "/midi-event") void event(req, res).catch(fail);
      else void listen(req, res, query).catch(fail);
    } catch {
      fail();
    }
    return true;
  };
}
