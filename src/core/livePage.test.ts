import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createLivePages, MAX_LIVE_ANSWER, parseQuery, type LivePages, type LiveRoutes } from "./livePage.js";
import { appLog } from "./log.js";

const HTML = '<html><script>const LIVE = /*LIVE_PLACEHOLDER*/null;</script></html>';

async function withServer(
  options: { available?: boolean; budgetMs?: number },
  body: (ctx: { pages: LivePages; port: number; get: (path: string, headers?: Record<string, string>, method?: string) => Promise<{ status: number; text: string }> }) => Promise<void>,
): Promise<void> {
  let pages!: LivePages;
  const server = http.createServer((req, res) => {
    if (!pages.handle(req, res)) res.writeHead(404).end("other");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  pages = createLivePages({ port, available: () => options.available !== false, budgetMs: options.budgetMs });
  const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      });
      req.on("error", reject);
      req.end();
    });
  try {
    await body({ pages, port, get });
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const tokenOf = (url: string): string => /t=([0-9a-f]+)$/.exec(url)![1]!;
const pathOf = (url: string): string => url.replace(/^http:\/\/localhost:\d+/, "");
/** Load the page (the one allowed load) and read the route token out of it: the only Bearer the routes accept. */
async function routeToken(get: (path: string, headers?: Record<string, string>) => Promise<{ status: number; text: string }>, url: string): Promise<string> {
  const page = await get(pathOf(url));
  assert.equal(page.status, 200);
  return /"token":"([0-9a-f]{32})"/.exec(page.text)![1]!;
}

test("a token is minted per dialog (128 bits), loads the page ONCE, with {base, token} in it", async () => {
  await withServer({}, async ({ pages, port, get }) => {
    const a = pages.open("monitor", HTML, {})!;
    const b = pages.open("learn", HTML, {})!;
    assert.match(a.url, new RegExp(`^http://localhost:${port}/live/monitor\\?t=[0-9a-f]{32}$`));
    assert.notEqual(tokenOf(a.url), tokenOf(b.url));
    const first = await get(pathOf(a.url));
    assert.equal(first.status, 200);
    assert.ok(first.text.includes(`"base":"http://localhost:${port}/live/monitor"`));
    assert.ok(/"token":"[0-9a-f]{32}"/.test(first.text));
    assert.notEqual(/"token":"([0-9a-f]{32})"/.exec(first.text)![1], tokenOf(a.url)); // the route token is not the URL's load token
    assert.ok(!first.text.includes("LIVE_PLACEHOLDER"));
    assert.equal((await get(pathOf(a.url))).status, 404); // used once
    assert.equal((await get(`/live/learn?t=${"0".repeat(32)}`)).status, 404); // a wrong token
    assert.equal((await get("/live/learn")).status, 404); // no token
    assert.equal((await get(pathOf(b.url))).status, 200);
  });
});

test("parseQuery: decoded text values, bad escapes dropped, capped, no prototype", () => {
  assert.deepEqual({ ...parseQuery("command=mute&line=mute%20%23drums+x") }, { command: "mute", line: "mute #drums x" });
  assert.deepEqual({ ...parseQuery("a=%E0%A4%A&b=1") }, { b: "1" }); // a bad escape drops that parameter
  assert.deepEqual({ ...parseQuery("") }, {});
  assert.deepEqual({ ...parseQuery("flag&x=") }, { flag: "", x: "" });
  assert.equal(Object.keys(parseQuery(Array.from({ length: 20 }, (_, i) => `k${i}=1`).join("&"))).length, 8);
  assert.deepEqual({ ...parseQuery("x".repeat(5000)) }, {});
  assert.equal(Object.getPrototypeOf(parseQuery("a=1")), null);
  assert.equal(parseQuery("__proto__=x").toString, undefined);
});

test("a route reads the query string (the defaults page's /check)", async () => {
  await withServer({}, async ({ pages, get }) => {
    const s = pages.open("defaults", HTML, { check: (q) => ({ command: q.command, line: q.line, missing: q.nothing ?? null }) })!;
    const auth = { Authorization: `Bearer ${await routeToken(get, s.url)}` };
    const r = await get("/live/defaults/check?command=mute&line=mute%20%23a%3Bsolo", auth);
    assert.deepEqual(JSON.parse(r.text), { command: "mute", line: "mute #a;solo", missing: null });
    assert.equal((await get("/live/defaults/check?line=x")).status, 401); // the token still guards it
  });
});

test("routes need the Bearer token; unknown routes are 404; own properties only", async () => {
  await withServer({}, async ({ pages, get }) => {
    const calls: string[] = [];
    const routes: LiveRoutes = { rows: () => (calls.push("rows"), [{ n: 1 }]), later: async () => "ok" };
    const s = pages.open("monitor", HTML, routes)!;
    const loadToken = tokenOf(s.url);
    const token = await routeToken(get, s.url);
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await get("/live/monitor/rows", { Authorization: `Bearer ${loadToken}` })).status, 401); // what the URL leaves behind reads nothing
    assert.equal((await get("/live/monitor/rows")).status, 401);
    assert.equal((await get("/live/monitor/rows", { Authorization: `Bearer ${"1".repeat(32)}` })).status, 401);
    assert.equal((await get("/live/monitor/rows", { Authorization: token })).status, 401); // not a Bearer header
    assert.deepEqual(calls, []); // nothing ran without the token
    const ok = await get("/live/monitor/rows", auth);
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text), [{ n: 1 }]);
    assert.equal(JSON.parse((await get("/live/monitor/later", auth)).text), "ok"); // async routes too
    for (const name of ["nope", "toString", "__proto__", "constructor", "rows/extra"]) assert.equal((await get(`/live/monitor/${name}`, auth)).status, 404, name);
    assert.equal((await get("/live/other/rows", auth)).status, 404); // another page
    assert.equal((await get("/live/", auth)).status, 404);
  });
});

test("every request is checked: GET only, Host, Origin (absent or exactly localhost:port), Sec-Fetch-Site", async () => {
  await withServer({}, async ({ pages, port, get }) => {
    const s = pages.open("monitor", HTML, { rows: () => 1 })!;
    const auth = { Authorization: `Bearer ${await routeToken(get, s.url)}` };
    assert.equal((await get("/live/monitor/rows", auth, "POST")).status, 405);
    assert.equal((await get("/live/monitor/rows", auth, "PUT")).status, 405);
    assert.equal((await get("/live/monitor/rows", { ...auth, Host: "evil.example:80" })).status, 403); // DNS rebinding
    assert.equal((await get("/live/monitor/rows", { ...auth, Host: `127.0.0.1:${port}` })).status, 403);
    assert.equal((await get("/live/monitor/rows", { ...auth, Origin: "http://evil.example" })).status, 403);
    assert.equal((await get("/live/monitor/rows", { ...auth, Origin: "null" })).status, 403); // a data: page
    assert.equal((await get("/live/monitor/rows", { ...auth, Origin: `http://localhost:${port + 1}` })).status, 403);
    assert.equal((await get("/live/monitor/rows", { ...auth, Origin: `http://localhost:${port}` })).status, 200);
    assert.equal((await get("/live/monitor/rows", { ...auth, "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await get("/live/monitor/rows", { ...auth, "Sec-Fetch-Site": "same-site" })).status, 403);
    assert.equal((await get("/live/monitor/rows", { ...auth, "Sec-Fetch-Site": "same-origin" })).status, 200);
    // the page load obeys the same checks (a second page: the first one's load token is spent)
    const other = pages.open("learn", HTML, {})!;
    assert.equal((await get(pathOf(other.url), { Origin: "http://evil.example" })).status, 403);
    assert.equal((await get(pathOf(other.url), { Host: "evil.example" })).status, 403);
    assert.equal((await get(pathOf(other.url), { "Sec-Fetch-Site": "none" })).status, 200); // a navigation
  });
});

test("a throwing, rejecting, slow, huge or non-plain route answers {error} with status 200, never a crash", async () => {
  await withServer({ budgetMs: 30 }, async ({ pages, get }) => {
    const s = pages.open("monitor", HTML, {
      throws: () => {
        throw new Error("secret internal detail");
      },
      rejects: async () => Promise.reject(new Error("nope")),
      slow: () => new Promise(() => {}),
      huge: () => "x".repeat(MAX_LIVE_ANSWER + 10),
      loop: () => {
        const a: Record<string, unknown> = {};
        a.self = a;
        return a;
      },
      nothing: () => undefined,
    })!;
    const auth = { Authorization: `Bearer ${await routeToken(get, s.url)}` };
    for (const route of ["throws", "rejects", "slow", "huge", "loop"]) {
      const r = await get(`/live/monitor/${route}`, auth);
      assert.equal(r.status, 200, route);
      assert.ok("error" in JSON.parse(r.text), route);
      assert.ok(!r.text.includes("secret internal detail"), route); // no internals in the answer
    }
    assert.equal((await get("/live/monitor/nothing", auth)).text, "null");
  });
});

test("the token and the routes end with the dialog; a second open of the same page revokes the first", async () => {
  await withServer({}, async ({ pages, get }) => {
    const first = pages.open("monitor", HTML, { rows: () => 1 })!;
    const auth1 = { Authorization: `Bearer ${await routeToken(get, first.url)}` };
    assert.equal((await get("/live/monitor/rows", auth1)).status, 200);
    const second = pages.open("monitor", HTML, { rows: () => 2 })!;
    assert.equal((await get("/live/monitor/rows", auth1)).status, 401); // the first token is dead
    first.close(); // closing the old one must not end the new one
    const auth2 = { Authorization: `Bearer ${await routeToken(get, second.url)}` };
    assert.equal(JSON.parse((await get("/live/monitor/rows", auth2)).text), 2);
    second.close();
    assert.equal((await get("/live/monitor/rows", auth2)).status, 404);
    assert.equal((await get(pathOf(second.url))).status, 404);
    second.close(); // closing twice is harmless
  });
});

test("no server or a bad page name: open answers null (the caller shows a data page with LIVE = null)", async () => {
  await withServer({ available: false }, async ({ pages }) => {
    assert.equal(pages.open("monitor", HTML, {}), null);
  });
  await withServer({}, async ({ pages }) => {
    for (const name of ["", "A", "a/b", "../x", "a b", "a".repeat(41), "-x"]) assert.equal(pages.open(name, HTML, {}), null, JSON.stringify(name));
    assert.ok(pages.open("ok-name-1", HTML, {}));
  });
});

test("other URLs are not handled; the token never reaches the log", async () => {
  await withServer({}, async ({ pages, get }) => {
    assert.equal((await get("/open")).text, "other");
    assert.equal((await get("/livex/monitor")).text, "other");
    const s = pages.open("monitor", HTML, { rows: () => 1, bad: () => { throw new Error("x"); } })!;
    const loadToken = tokenOf(s.url);
    const token = await routeToken(get, s.url);
    await get("/live/monitor/rows", { Authorization: `Bearer ${token}` });
    await get("/live/monitor/bad", { Authorization: `Bearer ${token}` });
    s.close();
    const logged = appLog.lines(500).join("\n");
    assert.ok(!logged.includes(token) && !logged.includes(loadToken), "no token may ever be logged");
  });
});

test("a headless run dismisses a live page like any dialog and names it", async () => {
  const { createUiGate } = await import("./headless.js");
  const opened: string[] = [];
  const gate = createUiGate({
    prompt: async () => null,
    select: async () => null,
    notify: () => {},
    settings: async () => null, defaults: async () => null, board: async () => null,
    page: async () => null,
    livePage: async (name) => (opened.push(name), "real"),
  });
  const capture = { dialogs: [] as string[], notices: [] as string[] };
  const answer = await gate.within(capture, () => gate.ui.livePage("monitor", HTML, 100, 100, {}));
  assert.equal(answer, null);
  assert.deepEqual(capture.dialogs, ['page "monitor"']);
  assert.deepEqual(opened, []); // the real surface was never reached
  assert.equal(await gate.ui.livePage("monitor", HTML, 100, 100, {}), "real"); // outside a headless run it passes through
});

test("the served page carries a Content-Security-Policy that keeps the token and data on this server", async () => {
  await withServer({}, async ({ pages, port }) => {
    const s = pages.open("monitor", HTML, {})!;
    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: pathOf(s.url), headers: { Host: `localhost:${port}` } }, (res) => {
        res.resume();
        resolve(res.headers);
      }).on("error", reject);
    });
    assert.match(String(headers["content-security-policy"]), /default-src 'none'.*connect-src 'self'/);
    assert.equal(headers["cache-control"], "no-store");
    assert.equal(headers["referrer-policy"], "no-referrer");
  });
});

// ── waiting routes (long polling) ───────────────────────────────────────────────────────────────

/** A source the test controls: `push` resolves the held wait. */
function source() {
  const waiters: Array<(value: unknown) => void> = [];
  const cancelled: boolean[] = [];
  const asked: Array<number | null> = [];
  return {
    asked,
    cancelled,
    push: (value: unknown) => waiters.splice(0).forEach((w) => w(value)),
    held: () => waiters.length,
    route: {
      wait: (since: number | null, cancel: { onCancel(cb: () => void): void }) => {
        asked.push(since);
        return new Promise<unknown>((resolve) => {
          waiters.push(resolve);
          cancel.onCancel(() => {
            cancelled.push(true);
            waiters.length = 0;
          });
        });
      },
    },
  };
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test("a waiting route answers as soon as data arrives, with the since it was asked", async () => {
  await withServer({}, async ({ pages, get }) => {
    const src = source();
    const s = pages.open("monitor", HTML, { feed: src.route, plain: () => 1 })!;
    const auth = { Authorization: `Bearer ${await routeToken(get, s.url)}` };
    assert.equal((await get("/live/monitor/feed?since=0")).status, 401); // the token is needed here too
    const started = Date.now();
    const answer = get("/live/monitor/feed?since=41", auth);
    await tick(30);
    assert.equal(src.held(), 1); // held, not answered
    src.push({ last: 42, rows: [1] });
    const r = await answer;
    assert.deepEqual(JSON.parse(r.text), { last: 42, rows: [1] });
    assert.ok(Date.now() - started < 500, "answered as soon as data arrived, not at the timeout");
    assert.deepEqual(src.asked, [41]);
    assert.equal(src.cancelled.length, 1); // the wait's cancel callbacks ran when it ended normally
    assert.equal(JSON.parse((await get("/live/monitor/plain", auth)).text), 1); // plain routes still answer at once
    // no since (the page's first request) is null, a real 0 is 0; a bad since is null
    const none = get("/live/monitor/feed", auth);
    await tick(); src.push("a"); await none;
    const bad = get("/live/monitor/feed?since=abc", auth);
    await tick(); src.push("b"); await bad;
    const zero = get("/live/monitor/feed?since=0", auth);
    await tick(); src.push("c"); await zero;
    assert.deepEqual(src.asked, [41, null, null, 0]);
  });
});

test("nothing new within the hold: a { timeout: true } answer, and the wait is cancelled", async () => {
  await withServer({}, async () => {});
  // a short hold so the test is quick
  let pages!: LivePages;
  const server = http.createServer((req, res) => void (pages.handle(req, res) || res.writeHead(404).end()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  pages = createLivePages({ port, available: () => true, waitMs: 60 });
  const get = (path: string, headers: Record<string, string>) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      }).on("error", reject);
    });
  try {
    const src = source();
    const s = pages.open("monitor", HTML, { feed: src.route })!;
    const auth = { Authorization: `Bearer ${await routeToken((p, h) => get(p, h ?? {}), s.url)}` };
    const started = Date.now();
    const r = await get("/live/monitor/feed?since=1", auth);
    assert.deepEqual(JSON.parse(r.text), { timeout: true });
    assert.ok(Date.now() - started >= 55);
    assert.deepEqual(src.cancelled, [true]);
    assert.equal(src.held(), 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("closing the dialog releases a held request; a second waiting request replaces the first", async () => {
  await withServer({}, async ({ pages, get }) => {
    const src = source();
    const s = pages.open("monitor", HTML, { feed: src.route })!;
    const auth = { Authorization: `Bearer ${await routeToken(get, s.url)}` };
    const first = get("/live/monitor/feed?since=1", auth);
    await tick(20);
    const second = get("/live/monitor/feed?since=2", auth);
    assert.deepEqual(JSON.parse((await first).text), { replaced: true }); // answered at once, not left hanging
    await tick(20);
    assert.equal(src.cancelled.length, 1); // the first wait was cancelled
    s.close(); // the dialog ends while the second is held
    const closed = await second;
    assert.deepEqual(JSON.parse(closed.text), { error: "closed" });
    assert.equal(src.cancelled.length, 2);
    assert.equal(src.held(), 0);
  });
});

test("a client that goes away cancels its wait; a throwing or rejecting wait answers { error }", async () => {
  await withServer({}, async ({ pages, port, get }) => {
    const src = source();
    const s = pages.open("monitor", HTML, {
      feed: src.route,
      throws: {
        wait: () => {
          throw new Error("internal secret");
        },
      },
      rejects: { wait: async () => Promise.reject(new Error("internal secret")) },
    })!;
    const auth = { Authorization: `Bearer ${await routeToken(get, s.url)}` };
    const req = http.get({ host: "127.0.0.1", port, path: "/live/monitor/feed?since=1", headers: { Host: `localhost:${port}`, ...auth } });
    req.on("error", () => {});
    await tick(30);
    assert.equal(src.held(), 1);
    req.destroy(); // the page navigated away / the socket dropped
    await tick(30);
    assert.deepEqual(src.cancelled, [true]);
    assert.equal(src.held(), 0);
    for (const route of ["throws", "rejects"]) {
      const r = await get(`/live/monitor/${route}`, auth);
      assert.deepEqual(JSON.parse(r.text), { error: "no answer" }, route); // no internal text
    }
  });
});

test("an object route without a wait function is not a route", async () => {
  await withServer({}, async ({ pages, get }) => {
    const s = pages.open("monitor", HTML, { odd: {} as never, nulled: null as never })!;
    const auth = { Authorization: `Bearer ${await routeToken(get, s.url)}` };
    assert.equal((await get("/live/monitor/odd", auth)).status, 404);
    assert.equal((await get("/live/monitor/nulled", auth)).status, 404);
  });
});
