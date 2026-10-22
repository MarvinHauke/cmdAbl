import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type * as http from "node:http";
import { fromBrowserPage } from "./httpTrigger.js";
import { tokenFilePath } from "./ableton/bridgeToken.js";
import type { HeadlessOutcome } from "./core/headless.js";

// The development-only routes of the trigger server (plan 0016): `POST /run` runs one line
// headless and answers the outcome, `GET /log` the last lines of the log. They exist only in
// development builds (`CMDABL_DEV_ROUTES`, build.ts); a production bundle does not contain this
// file. Guards: no browser page, a Bearer token, one run at a time, nothing while the user has a
// palette or dialog open, and a time limit. The token is written to a file only the user can
// read; its value is never logged, never put in an answer and never in an error text.

export const RUN_TIMEOUT_MS = 10_000;
const MAX_BODY = 8 * 1024;
const MAX_LOG_LINES = 500;

/** `run-token`, next to the bridge token in the extension's data folder. */
export function runTokenFilePath(home?: string): string {
  return path.join(path.dirname(tokenFilePath(home)), "run-token");
}

/** A new random token, written to `file` (mode 0600). Returns the token, or null when it cannot be written. */
export function writeRunToken(file: string, fsApi: Pick<typeof fs, "mkdirSync" | "writeFileSync" | "chmodSync"> = fs): string | null {
  const token = crypto.randomBytes(32).toString("hex");
  try {
    fsApi.mkdirSync(path.dirname(file), { recursive: true });
    fsApi.writeFileSync(file, token, { mode: 0o600 });
    fsApi.chmodSync(file, 0o600); // an older file may have had other permissions
    return token;
  } catch {
    return null;
  }
}

export interface DevRouteDeps {
  token: string;
  /** Run one line headless. */
  run: (line: string) => Promise<HeadlessOutcome>;
  /** Why a run cannot start now (a palette or dialog is open), or null. */
  blocked: () => string | null;
  /** The last `count` log lines. */
  logLines: (count: number) => string[];
  timeoutMs?: number;
}

/** `/log?n=5#x` -> ["/log", "n=5"]: the path and the query, without URL (not available in Live's host). */
export function splitUrl(url: string | undefined): [string, string] {
  const raw = (url ?? "/").split("#")[0] ?? "/";
  const at = raw.indexOf("?");
  return at < 0 ? [raw, ""] : [raw.slice(0, at), raw.slice(at + 1)];
}

/** The first value of `name` in a query string (`a=1&n=7`), or undefined. No percent-decoding: only plain numbers are read. */
export function queryValue(query: string, name: string): string | undefined {
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if ((eq < 0 ? part : part.slice(0, eq)) === name) return eq < 0 ? "" : part.slice(eq + 1);
  }
  return undefined;
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer (.+)$/.exec(header) : null;
  return match !== null && sameToken(match[1]!, token);
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
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

const json = (res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
};

/** The trigger server's `extra` hook, plus `release` for a run that never ended (POST /reset). */
export type DevRoutes = ((req: http.IncomingMessage, res: http.ServerResponse) => boolean) & {
  /** Let the next `/run` start although the last one has not ended. True when a run was holding the route. */
  release(): boolean;
};

/**
 * The handler for the trigger server's `extra` hook: answers `/run` and `/log` and returns true,
 * or returns false for any other URL. Never throws.
 */
export function createDevRoutes(deps: DevRouteDeps): DevRoutes {
  let running = false;
  let runId = 0; // a run released by `release` must not free a newer run when it ends late
  const timeoutMs = deps.timeoutMs ?? RUN_TIMEOUT_MS;

  async function handleRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
    if (fromBrowserPage(req)) return void res.writeHead(403).end("forbidden");
    if (!authorized(req, deps.token)) return void json(res, 401, { error: "unauthorized" });
    const raw = await readBody(req);
    let line: unknown;
    try {
      line = raw === null ? undefined : (JSON.parse(raw) as { line?: unknown }).line;
    } catch {
      line = undefined;
    }
    if (typeof line !== "string" || line.trim() === "") return void json(res, 400, { error: 'body must be JSON like {"line": "vol -6 #drums"}' });
    if (running) return void json(res, 409, { error: "busy", reason: "another run is going" });
    const blocked = deps.blocked();
    if (blocked) return void json(res, 409, { error: "busy", reason: blocked });
    running = true;
    const id = ++runId;
    const done = Promise.resolve().then(() => deps.run(line)).finally(() => {
      if (runId === id) running = false; // free only when the run really ended, also after a timeout answer
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      const outcome = await Promise.race([done, timedOut]);
      if (outcome === "timeout") json(res, 504, { error: "timeout", reason: `the run took over ${Math.round(timeoutMs / 1000)} s; it may still be going` });
      else json(res, 200, outcome);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function handleLog(req: http.IncomingMessage, res: http.ServerResponse, query: string): void {
    if (req.method !== "GET") return void res.writeHead(405, { Allow: "GET" }).end();
    if (fromBrowserPage(req)) return void res.writeHead(403).end("forbidden");
    if (!authorized(req, deps.token)) return void json(res, 401, { error: "unauthorized" });
    const asked = Number(queryValue(query, "n") ?? "50");
    const count = Number.isFinite(asked) ? Math.min(MAX_LOG_LINES, Math.max(1, Math.floor(asked))) : 50;
    json(res, 200, { lines: deps.logLines(count) });
  }

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    // No URL / URLSearchParams: Live's Extension Host has neither (startup log "host globals").
    const [pathname = "", query = ""] = splitUrl(req.url);
    if (pathname !== "/run" && pathname !== "/log") return false;
    const fail = (): void => {
      try {
        json(res, 500, { error: "internal error" });
      } catch {
        // the response is already gone
      }
    };
    try {
      if (pathname === "/log") handleLog(req, res, query);
      else void handleRun(req, res).catch(fail);
    } catch {
      fail();
    }
    return true;
  };
  return Object.assign(handler, {
    release: (): boolean => {
      const was = running;
      running = false;
      runId++;
      return was;
    },
  });
}
