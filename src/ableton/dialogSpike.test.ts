import assert from "node:assert/strict";
import { test } from "node:test";
import { createDialogSpike } from "./dialogSpike.js";

type Out = { handled: boolean; status?: number; headers?: Record<string, unknown>; body?: string };
function make(show: (url: string) => Promise<string | null> = async () => "done") {
  const logs: string[] = [];
  const opened: string[] = [];
  let t = 1000;
  const handler = createDialogSpike({
    token: "t".repeat(64),
    showDialog: (url) => (opened.push(url), show(url)),
    log: (l) => void logs.push(l),
    now: () => t,
  });
  const call = (r: { url: string; method: string; headers?: Record<string, string>; body?: string }): Promise<Out> =>
    new Promise((resolve) => {
      const on: Record<string, (...a: unknown[]) => void> = {};
      const req = { url: r.url, method: r.method, headers: r.headers ?? {}, on: (n: string, f: (...a: unknown[]) => void) => ((on[n] = f), req) };
      const res = { writeHead: (status: number, headers?: Record<string, unknown>) => ({ end: (body?: string) => resolve({ handled: true, status, headers, body }) }) };
      if (!handler(req as never, res as never)) return resolve({ handled: false });
      queueMicrotask(() => {
        if (r.body) on.data?.(Buffer.from(r.body));
        on.end?.();
      });
    });
  return { call, logs, opened, advance: (ms: number) => void (t += ms) };
}
const auth = { authorization: `Bearer ${"t".repeat(64)}` };
/** The spike token the page carries, read out of the data: URL the dialog was opened with. */
const pageAuth = (url: string) => ({ authorization: `Bearer ${/TOKEN = "([0-9a-f]{32})"/.exec(decodeURIComponent(url))![1]}` });

test("spike: only /spike/ paths are handled", async () => {
  assert.equal((await make().call({ url: "/open", method: "GET" })).handled, false);
});

test("spike: ping and echo answer CORS for the data: page's origin 'null' only; echo needs the page token, not the run token", async () => {
  const { call, opened } = make();
  await call({ url: "/spike/open?mode=data", method: "POST", headers: auth });
  const ping = await call({ url: "/spike/ping", method: "GET", headers: { origin: "null" } });
  assert.equal(ping.headers?.["Access-Control-Allow-Origin"], "null");
  assert.equal((await call({ url: "/spike/ping", method: "GET", headers: { origin: "http://evil.example" } })).headers?.["Access-Control-Allow-Origin"], undefined);
  const pre = await call({ url: "/spike/echo", method: "OPTIONS", headers: { origin: "null" } });
  assert.equal(pre.status, 204);
  assert.match(String(pre.headers?.["Access-Control-Allow-Headers"]), /authorization/);
  assert.equal((await call({ url: "/spike/echo", method: "POST", headers: { origin: "null" } })).status, 401);
  assert.equal((await call({ url: "/spike/echo", method: "POST", headers: { origin: "null", ...auth } })).status, 401, "the run token opens nothing here");
  assert.equal((await call({ url: "/spike/echo", method: "POST", headers: { origin: "null", ...pageAuth(opened[0]!) } })).status, 200);
});

test("spike: open needs the token and no browser page; the data page carries the token only inside the data URL", async () => {
  const { call, opened, logs } = make();
  assert.equal((await call({ url: "/spike/open?mode=data", method: "POST" })).status, 401);
  assert.equal((await call({ url: "/spike/open?mode=data", method: "POST", headers: { ...auth, origin: "http://x" } })).status, 403);
  assert.equal((await call({ url: "/spike/open?mode=x", method: "POST", headers: auth })).status, 400);
  assert.equal((await call({ url: "/spike/open?mode=data", method: "POST", headers: auth })).status, 200);
  await new Promise((r) => setTimeout(r, 1));
  assert.match(opened[0]!, /^data:text\/html/);
  assert.ok(logs.some((l) => l.startsWith("dialog (data) returned: done")));
  assert.ok(!logs.join("\n").includes("t".repeat(64)), "the token is never logged");
  assert.ok(!decodeURIComponent(opened[0]!).includes("t".repeat(64)), "the run token is not in the dialog URL");
});

test("spike: the same-origin page is served once per nonce, for a minute, and only then", async () => {
  const { call, opened, advance } = make();
  await call({ url: "/spike/open?mode=http", method: "POST", headers: auth });
  const url = new RegExp("^http://localhost:27184(/spike/page\\?n=[0-9a-f]{32})$").exec(opened[0]!)?.[1];
  assert.ok(url);
  const page = await call({ url: url!, method: "GET" });
  assert.equal(page.status, 200);
  assert.match(page.body!, /BASE = ""/);
  assert.ok(!page.body!.includes("t".repeat(64)), "the run token is not in the served page");
  assert.equal((await call({ url: url!, method: "GET" })).status, 404); // used up
  await call({ url: "/spike/open?mode=http", method: "POST", headers: auth });
  advance(61_000);
  const late = /\/spike\/page\?n=[0-9a-f]{32}/.exec(opened[1]!)![0];
  assert.equal((await call({ url: late, method: "GET" })).status, 404);
  assert.equal((await call({ url: "/spike/page?n=zz", method: "GET" })).status, 404);
});

test("spike: report is logged with its origin, needs the page token", async () => {
  const { call, logs, opened } = make();
  await call({ url: "/spike/open?mode=data", method: "POST", headers: auth });
  assert.equal((await call({ url: "/spike/report", method: "POST", body: "{}" })).status, 401);
  assert.equal((await call({ url: "/spike/report", method: "POST", headers: { ...auth, origin: "null" }, body: "{}" })).status, 401);
  assert.equal((await call({ url: "/spike/report", method: "POST", headers: { ...pageAuth(opened[0]!), origin: "null" }, body: '{"a":1}' })).status, 200);
  assert.ok(logs.some((l) => l.includes('page report (origin "null"): {"a":1}')));
});
