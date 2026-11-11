import * as crypto from "node:crypto";
import type * as http from "node:http";
import { fillTemplate } from "./inlineJson.js";
import { logger } from "../log.js";
import { withBudget } from "../complete/completeSnapshot.js";

// Live pages (plan 0018, "Live pages"; the read-only exception to the dialog rule in CLAUDE.md).
// A module's page can be served from the trigger server, `http://localhost:<port>/live/<page>?t=<token>`, and
// read data from the module WHILE the dialog is open, through routes that exist only for that dialog:
//
//   GET /live/<page>?t=<load token>     the page HTML, once (this token loads the page a single time and is then dead)
//   GET /live/<page>/<route>            JSON from the module's route function; `Authorization: Bearer <route token>`
//
// Two tokens: the load token is in the dialog's URL (which Live or the web view may keep), the route token is written
// only into the served HTML (`LIVE.token`), so what the URL leaves behind cannot read any route.
//
// Page runs (plan 0018 "Page runs"): a page opened with `run` may also `POST /live/<page>/run` with `{ line }` and gets
// `{ code, text }`. That is the ONLY POST, with the same route token, Host/Origin checks and dialog lifetime; the module's
// allowlist is enforced by `LiveRun` (pageRun.ts), not here. Small bodies only.
//
// Rules on every request: GET only (but the one POST above); Host `localhost:<port>`; Origin absent or exactly `http://localhost:<port>`
// (and Sec-Fetch-Site same-origin / none when sent); the token compared in constant time. A route runs under a
// short budget and answers `{ error }` on a throw, a timeout or an oversized answer: never a crash, never a 5xx.
// Both tokens are 128 bits, minted per dialog, revoked when the dialog closes, and never logged. Nothing here writes.
// This is registered in release builds too (unlike the dev routes).

/**
 * Passed to a waiting route: the wait is over (the request was answered, replaced, aborted or the dialog closed).
 * Drop what you listen to in `onCancel`; it is called at most once, also when the wait ends normally.
 */
export interface LiveCancel {
  readonly cancelled: boolean;
  onCancel(callback: () => void): void;
}

/** The request's query string as plain text values (`/check?command=mute&line=mute%20%23a`); a route may read it (phase 1b of plan 0019). */
export type LiveQuery = Readonly<Record<string, string>>;

/** Most bytes of query string a route is given and most parameters it sees. */
const MAX_QUERY = 4096;
const MAX_PARAMS = 8;

/** The query as a record without a prototype; what does not decode, is too long or is over the cap is dropped. Never throws. */
export function parseQuery(query: string): LiveQuery {
  const out: Record<string, string> = Object.create(null);
  if (query.length > MAX_QUERY) return out;
  let count = 0;
  for (const pair of query.split("&")) {
    if (pair === "" || count >= MAX_PARAMS) continue;
    const eq = pair.indexOf("=");
    try {
      const key = decodeURIComponent((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, " "));
      if (key === "" || key.length > 40 || key in out) continue;
      out[key] = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
      count++;
    } catch {
      // a bad escape: this parameter is dropped
    }
  }
  return out;
}

/**
 * One route: a plain read function (answered at once, under the 100 ms budget), or a WAITING route (long polling):
 * the server holds the request until `wait` resolves, or `WAIT_MS` (1000 ms) pass, whichever comes first.
 * `since` is what the page last saw (`?since=<number>` on the request; `null` when the page sent none, i.e. its first
 * request: answer with what you have at once). A real number, 0 included, means "hold until something newer":
 * resolve as soon as the source has something NEWER than that, with the data. On the timeout the page gets `{ "timeout": true }`; if its next request
 * replaced this one, `{ "replaced": true }`; if the dialog closed, `{ "error": "closed" }`.
 */
export type LiveRoute = ((query: LiveQuery) => unknown | Promise<unknown>) | { wait: (since: number | null, cancel: LiveCancel) => unknown | Promise<unknown> };

/** The read-only data sources of one live page: `{ monitor: () => rows }` is served at `/live/<page>/monitor`. */
export type LiveRoutes = Record<string, LiveRoute>;

/** Runs a command line a live page posted (already restricted to the module's allowlist by the caller); never throws. */
export type LiveRun = (line: string) => Promise<{ code: number; text: string }>;

/** Most bytes of a page-run body and most characters of its line. */
export const MAX_RUN_BODY = 4096;
export const MAX_RUN_LINE = 1000;
const BODY_MS = 2000;

/** One open live page: the URL the dialog loads, and `close()` which revokes the token and the routes. */
export interface LiveSession {
  url: string;
  close(): void;
}

export interface LivePages {
  /**
   * Register a live page. `html` holds `const LIVE = /*LIVE_PLACEHOLDER*\/null;`: the served copy gets
   * `{ base, token }` there (`base` = `http://localhost:<port>/live/<page>`; the page fetches `${base}/<route>` with
   * `Authorization: Bearer ${token}`). Returns null when it cannot be served (the server is not listening, or the
   * name is not a plain page name): the caller then shows the page as a data page with `LIVE = null`.
   * A second open of the same page revokes the first.
   */
  open(name: string, html: string, routes: LiveRoutes, run?: LiveRun): LiveSession | null;
  /** The trigger server's `extra` hook: true when the request was for `/live/…`. Never throws. */
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
}

export interface LivePagesDeps {
  port: number;
  /** Is the server listening? (A port that was taken means no live pages.) */
  available: () => boolean;
  /** Longest wait for one route (default 100 ms). */
  budgetMs?: number;
  /** Longest hold of a waiting route (default 1000 ms). */
  waitMs?: number;
  /** A fresh token (default 16 random bytes as 32 hex characters); tests pass their own. */
  newToken?: () => string;
}

export const LIVE_BUDGET_MS = 100;
/** How long a waiting route holds a request at most. */
export const WAIT_MS = 1000;
export const MAX_LIVE_ANSWER = 256 * 1024;
const PAGE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TOKEN = /(?:^|&)t=([0-9a-f]{32})(?:&|$)/;

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createLivePages(deps: LivePagesDeps): LivePages {
  const log = logger("live");
  const origin = `http://localhost:${deps.port}`;
  const budgetMs = deps.budgetMs ?? LIVE_BUDGET_MS;
  const waitMs = deps.waitMs ?? WAIT_MS;
  const newToken = deps.newToken ?? (() => crypto.randomBytes(16).toString("hex"));
  interface Session {
    name: string;
    /** In the dialog's URL: loads the page once. */
    loadToken: string;
    /** Only in the served HTML: the Bearer for the routes. */
    routeToken: string;
    html: string;
    routes: LiveRoutes;
    /** Present when the module allowed command lines for this page. */
    run?: LiveRun;
    loaded: boolean;
    /** The one waiting request of this dialog; a second replaces it. */
    waiter?: { end(how: unknown): void };
  }
  const sessions = new Map<string, Session>();

  function send(res: http.ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8", extra: http.OutgoingHttpHeaders = {}): void {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra }).end(body);
  }
  const json = (res: http.ServerResponse, status: number, body: unknown): void => send(res, status, JSON.stringify(body), "application/json");

  async function serve(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, query: string): Promise<void> {
    const isPost = req.method === "POST";
    // POST is for `<page>/run` only; everything else stays GET-only.
    if (req.method !== "GET" && !(isPost && pathname.endsWith("/run"))) return send(res, 405, "", undefined, { Allow: "GET" });
    // The page is loaded from this origin by the dialog; nothing else may read it (DNS rebinding, another page, another origin).
    const hostHeader = req.headers.host;
    if (hostHeader !== `localhost:${deps.port}`) return send(res, 403, "forbidden");
    const fromOrigin = req.headers.origin;
    if (fromOrigin !== undefined && fromOrigin !== origin) return send(res, 403, "forbidden");
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") return send(res, 403, "forbidden");

    const parts = pathname.slice("/live/".length).split("/");
    const session = sessions.get(parts[0] ?? "");
    if (!session || parts.length > 2) return send(res, 404, "not found");

    if (parts.length === 1) {
      // The page load: the token in the URL, once.
      const given = TOKEN.exec(query)?.[1];
      if (given === undefined || session.loaded || !sameToken(given, session.loadToken)) return send(res, 404, "not found");
      session.loaded = true;
      const html = fillTemplate(session.html, { LIVE: { base: `${origin}/live/${session.name}`, token: session.routeToken } });
      // Even an injected script cannot send the token or the data anywhere but back to this server.
      const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:";
      return send(res, 200, html, "text/html; charset=utf-8", { "Content-Security-Policy": csp });
    }

    const header = req.headers.authorization;
    const bearer = typeof header === "string" ? /^Bearer ([0-9a-f]{32})$/.exec(header)?.[1] : undefined;
    if (bearer === undefined || !sameToken(bearer, session.routeToken)) return send(res, 401, "unauthorized");
    const route = parts[1] ?? "";
    if (isPost) return route === "run" && parts.length === 2 ? runLine(req, res, session) : send(res, 404, "not found");
    if (route === "run" && session.run) return send(res, 405, "", undefined, { Allow: "POST" });
    if (!Object.prototype.hasOwnProperty.call(session.routes, route)) return send(res, 404, "not found");
    const entry = session.routes[route];
    if (typeof entry === "object" && entry !== null && typeof entry.wait === "function") {
      return hold(req, res, session, route, entry.wait, (() => {
        const given = /(?:^|&)since=(\d{1,15})(?:&|$)/.exec(query)?.[1];
        return given === undefined ? null : Number(given); // no (or a bad) since = the page's first request: null
      })());
    }
    if (typeof entry !== "function") return send(res, 404, "not found");
    const answer = await withBudget<unknown>(() => entry(parseQuery(query)), budgetMs, { error: "no answer" }, (why) => log.debug(`route ${session.name}/${route}: ${why}`));
    sendData(res, answer);
  }

  /** POST /run: read the small JSON body, run the line, answer `{ code, text }`. */
  async function runLine(req: http.IncomingMessage, res: http.ServerResponse, session: Session): Promise<void> {
    if (!session.run) return send(res, 404, "not found");
    const body = await readBody(req);
    if (body === null) return send(res, 413, "too large");
    let line: unknown;
    try {
      line = (JSON.parse(body) as { line?: unknown } | null)?.line;
    } catch {
      line = undefined;
    }
    if (typeof line !== "string" || line.length > MAX_RUN_LINE) return json(res, 200, { code: 2, text: "usage: POST { line } (a string, at most 1000 characters)" });
    let answer: { code: number; text: string };
    try {
      answer = await session.run(line);
    } catch (e: unknown) {
      log.warn(`page run ${session.name}: ${e instanceof Error ? e.message : String(e)}`);
      answer = { code: 1, text: "run failed" };
    }
    json(res, 200, answer);
  }

  /** The body as text, or null when it is over MAX_RUN_BODY (the request is then drained and dropped). */
  function readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      let size = 0;
      let over = false;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_RUN_BODY) over = true;
        else chunks.push(c);
      });
      // A client that never ends its body must not hold the socket.
      const timer = setTimeout(() => {
        over = true;
        resolve(null);
        req.destroy();
      }, BODY_MS);
      (timer as { unref?: () => void }).unref?.();
      req.on("end", () => (clearTimeout(timer), resolve(over ? null : Buffer.concat(chunks).toString("utf8"))));
      req.on("error", () => (clearTimeout(timer), resolve(null)));
    });
  }

  /** The answer as JSON: `{ error }` for what cannot be serialised or is too large. */
  function sendData(res: http.ServerResponse, answer: unknown): void {
    let text: string;
    try {
      text = JSON.stringify(answer === undefined ? null : answer);
    } catch {
      text = JSON.stringify({ error: "not plain data" });
    }
    if (text.length > MAX_LIVE_ANSWER) text = JSON.stringify({ error: "answer too large" });
    send(res, 200, text, "application/json");
  }

  /** A waiting route: hold the request until the source answers, the time is up, a newer request replaces it, the client leaves or the dialog closes. */
  function hold(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    session: Session,
    route: string,
    wait: (since: number | null, cancel: LiveCancel) => unknown | Promise<unknown>,
    since: number | null,
  ): Promise<void> {
    session.waiter?.end({ replaced: true }); // at most one waiting request per dialog
    return new Promise<void>((resolve) => {
      let done = false;
      const callbacks: Array<() => void> = [];
      const cancel: LiveCancel = {
        get cancelled() {
          return done;
        },
        onCancel(callback) {
          if (done) queueMicrotask(callback);
          else callbacks.push(callback);
        },
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const end = (how: unknown): void => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (session.waiter === waiter) session.waiter = undefined;
        for (const callback of callbacks.splice(0)) {
          try {
            callback();
          } catch {
            // a broken cancel callback must not keep the socket
          }
        }
        if (!res.destroyed && !res.writableEnded) sendData(res, how);
        resolve();
      };
      const waiter = { end };
      session.waiter = waiter;
      timer = setTimeout(() => end({ timeout: true }), waitMs);
      (timer as { unref?: () => void }).unref?.();
      res.on("close", () => end(undefined)); // the client went away (res 'close' fires on a disconnect in every Node version): free everything, answer nobody
      let pending: unknown;
      try {
        pending = wait(since, cancel);
      } catch (e: unknown) {
        log.debug(`route ${session.name}/${route} wait: ${e instanceof Error ? e.message : String(e)}`);
        return end({ error: "no answer" });
      }
      Promise.resolve(pending).then(
        (value) => end(value),
        (e: unknown) => {
          log.debug(`route ${session.name}/${route} wait: ${e instanceof Error ? e.message : String(e)}`);
          end({ error: "no answer" });
        },
      );
    });
  }

  return {
    open(name, html, routes, run) {
      if (!deps.available() || !PAGE_NAME.test(name) || typeof html !== "string") return null;
      const session: Session = { name, loadToken: newToken(), routeToken: newToken(), html, routes, ...(run ? { run } : {}), loaded: false };
      sessions.set(name, session); // a second open of the same page revokes the first
      log.debug(`live page "${name}" opened`);
      return {
        url: `${origin}/live/${name}?t=${session.loadToken}`,
        close: () => {
          session.waiter?.end({ error: "closed" }); // release a held request
          if (sessions.get(name) === session) {
            sessions.delete(name);
            log.debug(`live page "${name}" closed`);
          }
        },
      };
    },

    handle(req, res) {
      const raw = (req.url ?? "/").split("#")[0] ?? "/";
      const at = raw.indexOf("?");
      const pathname = at < 0 ? raw : raw.slice(0, at);
      if (!pathname.startsWith("/live/")) return false;
      const query = at < 0 ? "" : raw.slice(at + 1);
      serve(req, res, pathname, query).catch(() => {
        try {
          json(res, 200, { error: "internal error" });
        } catch {
          // the response is already gone
        }
      });
      return true;
    },
  };
}

