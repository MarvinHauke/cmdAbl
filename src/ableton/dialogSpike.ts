import * as crypto from "node:crypto";
import type * as http from "node:http";
import { fromBrowserPage } from "../httpTrigger.js";

// SPIKE, development builds only (never in a production bundle, extension.ts guards it): can a dialog
// page reach cmdAbl's local server while it is open? Two page variants are tried:
//   data  — the page is a `data:` URL (origin "null"), as every cmdAbl dialog is today; it fetches
//           http://127.0.0.1:27184/spike/… cross-origin (CORS, preflight for the Authorization header);
//   http  — the dialog URL is http://localhost:27184/spike/page?n=<nonce>, so the page is same-origin.
// The page measures round trips and a 100 ms polling loop and sends its numbers back twice: POST
// /spike/report (logged) and as the dialog's close string (logged). The page carries a spike-only token
// (random per process, good for /spike/echo and /spike/report and nothing else); the development run token
// (which can run commands) only guards /spike/open and never leaves this process. Neither is ever logged.
//
// Routes:  POST /spike/open?mode=data|http  (Bearer) opens the dialog and answers at once
//          GET  /spike/ping                  CORS answer, no auth: the cheapest round trip
//          OPTIONS/POST /spike/echo          Bearer, CORS preflight path
//          GET  /spike/page?n=<nonce>        the same-origin page; the nonce works once, for a minute
//          POST /spike/report                Bearer, the page's numbers

const PAGE_PORT = 27184;
const NONCE_MS = 60_000;

export interface DialogSpikeDeps {
  /** The development token that guards /spike/open. It is never put into a page. */
  token: string;
  /** Open a modal dialog on `url` (the SDK modal dialog, passed in by extension.ts); resolves with the page's close string. */
  showDialog: (url: string, width: number, height: number) => Promise<string | null>;
  log: (line: string) => void;
  now?: () => number;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>cmdAbl network spike</title>
<style>body{font:13px/1.4 -apple-system,sans-serif;margin:14px;background:#222;color:#ddd}pre{white-space:pre-wrap}#bar{height:10px;background:#4a8;width:0}</style>
<div id="bar"></div><pre id="out">running…</pre>
<script>
const BASE = __BASE__, TOKEN = __TOKEN__, MODE = __MODE__;
const out = document.getElementById('out'), bar = document.getElementById('bar');
const R = { mode: MODE, origin: location.origin, ua: navigator.userAgent, tests: {} };
const show = () => { out.textContent = JSON.stringify(R, null, 1); };
const stats = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return { n: s.length, min: +s[0].toFixed(1), median: +s[s.length >> 1].toFixed(1), max: +s[s.length - 1].toFixed(1) }; };
const err = e => (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
async function seq(name, n, make) {
  const t = [], errors = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    try { const r = await make(); if (!r.ok) throw new Error('HTTP ' + r.status); await r.text(); t.push(performance.now() - s); }
    catch (e) { errors.push(err(e)); if (errors.length >= 3) break; }
  }
  R.tests[name] = { rtt_ms: stats(t), errors: [...new Set(errors)] };
  show();
}
async function poll() {
  const gaps = [], rtt = [], errors = [];
  let last = performance.now(), frames = 0, maxFrame = 0, lastFrame = last;
  const raf = () => { const n = performance.now(); maxFrame = Math.max(maxFrame, n - lastFrame); lastFrame = n; frames++; bar.style.width = (n / 20 % 100) + '%'; if (running) requestAnimationFrame(raf); };
  let running = true; requestAnimationFrame(raf);
  await new Promise(done => {
    let k = 0;
    const id = setInterval(async () => {
      const now = performance.now(); gaps.push(now - last); last = now;
      const s = performance.now();
      try { const r = await fetch(BASE + '/spike/ping'); await r.text(); rtt.push(performance.now() - s); } catch (e) { errors.push(err(e)); }
      if (++k >= 50) { clearInterval(id); setTimeout(done, 150); }
    }, 100);
  });
  running = false;
  R.tests.poll_100ms = { interval_ms: stats(gaps.slice(1)), rtt_ms: stats(rtt), frames, max_frame_gap_ms: +maxFrame.toFixed(1), errors: [...new Set(errors)] };
  show();
}
function send(value) {
  const m = { method: 'close_and_send', params: [value] };
  if (window.webkit?.messageHandlers?.live) window.webkit.messageHandlers.live.postMessage(m);
  else if (window.chrome?.webview) window.chrome.webview.postMessage(m);
}
(async () => {
  try {
    await seq('get_ping', 50, () => fetch(BASE + '/spike/ping'));
    await seq('post_with_authorization', 30, () => fetch(BASE + '/spike/echo', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: '{}' }));
    await poll();
  } catch (e) { R.fatal = err(e); }
  let reported = 'not tried';
  try { const r = await fetch(BASE + '/spike/report', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(R) }); reported = 'HTTP ' + r.status; } catch (e) { reported = err(e); }
  R.report_post = reported; show();
  setTimeout(() => send(JSON.stringify(R)), 2500);
})();
</script>`;

function pageHtml(base: string, token: string, mode: string): string {
  // JSON.stringify gives valid JS literals; "<" is escaped so the data can never close the script tag.
  const lit = (v: string): string => JSON.stringify(v).replace(/</g, "\\u003c");
  return PAGE.replace("__BASE__", lit(base)).replace("__TOKEN__", lit(token)).replace("__MODE__", lit(mode));
}

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The trigger server's `extra` hook for the spike routes: true when handled. Never throws. */
export function createDialogSpike(deps: DialogSpikeDeps): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const now = deps.now ?? Date.now;
  const nonces = new Map<string, number>();
  /** The token the page carries: random per process, valid for /spike/echo and /spike/report only. */
  const pageToken = crypto.randomBytes(16).toString("hex");
  const bearerIs = (req: http.IncomingMessage, expected: string): boolean => {
    const h = req.headers.authorization;
    const m = typeof h === "string" ? /^Bearer (.+)$/.exec(h) : null;
    return m !== null && sameToken(m[1]!, expected);
  };
  const bearerOk = (req: http.IncomingMessage): boolean => bearerIs(req, pageToken);
  /** CORS for the `data:` page: its origin is the string "null". Anything else gets no CORS header. */
  const cors = (req: http.IncomingMessage): http.OutgoingHttpHeaders => {
    const origin = req.headers.origin;
    const out: http.OutgoingHttpHeaders = { Vary: "Origin", "Cache-Control": "no-store" };
    if (origin === "null") {
      out["Access-Control-Allow-Origin"] = "null";
      out["Access-Control-Allow-Headers"] = "authorization, content-type";
      out["Access-Control-Allow-Methods"] = "GET, POST";
      out["Access-Control-Max-Age"] = "0"; // measure the preflight every time
    }
    return out;
  };
  const body = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size <= 16 * 1024) chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => resolve(""));
    });

  async function open(req: http.IncomingMessage, res: http.ServerResponse, query: string): Promise<void> {
    if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
    if (fromBrowserPage(req)) return void res.writeHead(403).end("forbidden");
    if (!bearerIs(req, deps.token)) return void res.writeHead(401).end("unauthorized");
    const mode = /(?:^|&)mode=(data|http)(?:&|$)/.exec(query)?.[1];
    if (!mode) return void res.writeHead(400).end("mode=data|http");
    let url: string;
    if (mode === "http") {
      const nonce = crypto.randomBytes(16).toString("hex");
      nonces.set(nonce, now() + NONCE_MS);
      url = `http://localhost:${PAGE_PORT}/spike/page?n=${nonce}`;
    } else {
      url = `data:text/html;charset=utf-8,${encodeURIComponent(pageHtml(`http://127.0.0.1:${PAGE_PORT}`, pageToken, "data"))}`;
    }
    res.writeHead(200).end(`opening ${mode} dialog`);
    deps.showDialog(url, 560, 420).then(
      (result) => deps.log(`dialog (${mode}) returned: ${(result ?? "(closed without an answer)").slice(0, 1500)}`),
      (e: unknown) => deps.log(`dialog (${mode}) failed to open: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse, path: string, query: string): void {
    if (path === "/spike/open") return void open(req, res, query).catch(() => res.writeHead(500).end());
    if (path === "/spike/ping") {
      if (req.method !== "GET") return void res.writeHead(405).end();
      return void res.writeHead(200, { ...cors(req), "Content-Type": "application/json" }).end(JSON.stringify({ t: now() }));
    }
    if (path === "/spike/echo") {
      if (req.method === "OPTIONS") return void res.writeHead(204, cors(req)).end();
      if (req.method !== "POST") return void res.writeHead(405).end();
      if (!bearerOk(req)) return void res.writeHead(401, cors(req)).end("unauthorized");
      return void res.writeHead(200, { ...cors(req), "Content-Type": "application/json" }).end(JSON.stringify({ t: now() }));
    }
    if (path === "/spike/report") {
      if (req.method === "OPTIONS") return void res.writeHead(204, cors(req)).end();
      if (req.method !== "POST") return void res.writeHead(405).end();
      if (!bearerOk(req)) return void res.writeHead(401, cors(req)).end("unauthorized");
      void body(req).then((text) => {
        deps.log(`page report (origin ${JSON.stringify(req.headers.origin ?? null)}): ${text.slice(0, 1500)}`);
        res.writeHead(200, cors(req)).end("ok");
      });
      return;
    }
    if (path === "/spike/page") {
      const nonce = /(?:^|&)n=([0-9a-f]{32})(?:&|$)/.exec(query)?.[1];
      const until = nonce ? nonces.get(nonce) : undefined;
      if (nonce) nonces.delete(nonce); // one use
      if (req.method !== "GET" || until === undefined || until < now()) return void res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(pageHtml("", pageToken, "http"));
    }
  }

  return (req, res) => {
    const url = (req.url ?? "/").split("#")[0] ?? "/";
    const at = url.indexOf("?");
    const path = at < 0 ? url : url.slice(0, at);
    if (!path.startsWith("/spike/")) return false;
    try {
      handle(req, res, path, at < 0 ? "" : url.slice(at + 1));
    } catch {
      try {
        res.writeHead(500).end();
      } catch {
        // the response is already gone
      }
    }
    return true;
  };
}
