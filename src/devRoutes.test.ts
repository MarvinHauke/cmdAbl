import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createDevRoutes, queryValue, splitUrl, runTokenFilePath, writeRunToken, type DevRouteDeps } from "./devRoutes.js";
import type { HeadlessOutcome } from "./core/headless.js";

const TOKEN = "fake-token";
let lastRoutes: ReturnType<typeof createDevRoutes> | undefined;
const outcome = (over: Partial<HeadlessOutcome> = {}): HeadlessOutcome => ({ code: 0, message: "", log: ["l1"], dialogs: [], notices: [], ms: 1, ...over });

async function withServer(over: Partial<DevRouteDeps>, fn: (call: (method: string, url: string, init?: { token?: string | null; body?: string; headers?: Record<string, string> }) => Promise<{ status: number; body: any }>) => Promise<void>): Promise<void> {
  const routes = createDevRoutes({ token: TOKEN, run: async () => outcome(), blocked: () => null, logLines: (n) => Array.from({ length: Math.min(n, 3) }, (_, i) => `line ${i}`), ...over });
  lastRoutes = routes;
  const server = http.createServer((req, res) => {
    if (!routes(req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const call = async (method: string, url: string, init: { token?: string | null; body?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.token !== null) headers.Authorization = `Bearer ${init.token ?? TOKEN}`;
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers, body: init.body });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // plain text
    }
    return { status: res.status, body };
  };
  try {
    await fn(call);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

test("POST /run runs the line and answers the outcome", async () => {
  const lines: string[] = [];
  await withServer({ run: async (line) => (lines.push(line), outcome({ message: "ok!" })) }, async (call) => {
    const res = await call("POST", "/run", { body: JSON.stringify({ line: "vol -6 #drums" }) });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, "ok!");
    assert.deepEqual(lines, ["vol -6 #drums"]);
  });
});

test("guards: method, browser pages, token, body", async () => {
  await withServer({}, async (call) => {
    assert.equal((await call("GET", "/run")).status, 405);
    assert.equal((await call("POST", "/run", { body: '{"line":"x"}', headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await call("POST", "/run", { body: '{"line":"x"}', headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await call("POST", "/run", { body: '{"line":"x"}', token: null })).status, 401);
    assert.equal((await call("POST", "/run", { body: '{"line":"x"}', token: "wrong" })).status, 401);
    assert.equal((await call("POST", "/run", { body: "not json" })).status, 400);
    assert.equal((await call("POST", "/run", { body: '{"line":""}' })).status, 400);
    assert.equal((await call("POST", "/run", { body: '{"line":5}' })).status, 400);
    assert.equal((await call("GET", "/log", { token: null })).status, 401);
    assert.equal((await call("GET", "/log", { headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await call("POST", "/log")).status, 405);
  });
});

test("a run while the palette or a dialog is open answers 409", async () => {
  let reason: string | null = "a palette or dialog is open";
  let ran = 0;
  await withServer({ blocked: () => reason, run: async () => (ran++, outcome()) }, async (call) => {
    const busy = await call("POST", "/run", { body: '{"line":"x"}' });
    assert.equal(busy.status, 409);
    assert.match(busy.body.reason, /palette or dialog/);
    assert.equal(ran, 0);
    reason = null;
    assert.equal((await call("POST", "/run", { body: '{"line":"x"}' })).status, 200);
  });
});

test("a second run while one is going answers 409; it is free again afterwards", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await withServer({ run: async () => (await gate, outcome()) }, async (call) => {
    const first = call("POST", "/run", { body: '{"line":"a"}' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call("POST", "/run", { body: '{"line":"b"}' })).status, 409);
    release();
    assert.equal((await first).status, 200);
    assert.equal((await call("POST", "/run", { body: '{"line":"c"}' })).status, 200);
  });
});

test("a run over the time limit answers 504 and keeps the route busy until it ends", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await withServer({ timeoutMs: 40, run: async () => (await gate, outcome()) }, async (call) => {
    assert.equal((await call("POST", "/run", { body: '{"line":"slow"}' })).status, 504);
    assert.equal((await call("POST", "/run", { body: '{"line":"next"}' })).status, 409);
    release();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call("POST", "/run", { body: '{"line":"next"}' })).status, 200);
  });
});

test("a throwing run is an error answer, not a crash", async () => {
  await withServer({ run: () => { throw new Error("secret detail"); } }, async (call) => {
    const res = await call("POST", "/run", { body: '{"line":"x"}' });
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes("secret detail"));
  });
});

test("GET /log answers the last n lines (default 50, at most 500); other URLs are not handled", async () => {
  let asked = 0;
  await withServer({ logLines: (n) => ((asked = n), ["a", "b"]) }, async (call) => {
    assert.deepEqual((await call("GET", "/log?n=7")).body, { lines: ["a", "b"] });
    assert.equal(asked, 7);
    await call("GET", "/log");
    assert.equal(asked, 50);
    await call("GET", "/log?n=99999");
    assert.equal(asked, 500);
    await call("GET", "/log?n=abc");
    assert.equal(asked, 50);
    assert.equal((await call("GET", "/other")).status, 404);
  });
});

test("the token file: random, mode 0600, next to the bridge token; a failing write gives null", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-token-"));
  try {
    const file = path.join(dir, "sub", "run-token");
    const token = writeRunToken(file);
    assert.match(token ?? "", /^[0-9a-f]{64}$/);
    assert.equal(fs.readFileSync(file, "utf8"), token);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.notEqual(writeRunToken(file), token);
    assert.equal(writeRunToken(path.join(file, "blocked", "run-token")), null);
    assert.equal(path.basename(runTokenFilePath("/home/x")), "run-token");
    assert.match(runTokenFilePath("/home/x"), /Extensions Data\/marvinhauke\.cmdabl\/run-token$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the production bundle has no dev routes; the development bundle has them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-bundle-"));
  try {
    const build = (args: string[]): string => {
      const out = path.join(dir, args.includes("--production") ? "prod.js" : "dev.js");
      const run = spawnSync(process.execPath, ["--import", "tsx", "build.ts", ...args, `--outfile=${out}`], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      return fs.readFileSync(out, "utf8");
    };
    const marker = "run-token";
    assert.ok(!build(["--production"]).includes(marker), "the production bundle must not contain the dev routes");
    assert.ok(build([]).includes(marker), "the development bundle must contain them");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("release frees the route after a stuck run; the stuck run ending late does not free a newer one", async () => {
  const stuck: Array<() => void> = [];
  await withServer({ timeoutMs: 30, run: (line) => new Promise((r) => { if (line === "stuck") stuck.push(() => r(outcome())); else setTimeout(() => r(outcome()), 80); }) }, async (call) => {
    assert.equal((await call("POST", "/run", { body: '{"line":"stuck"}' })).status, 504);
    assert.equal((await call("POST", "/run", { body: '{"line":"next"}' })).status, 409);
    assert.equal(lastRoutes!.release(), true);
    assert.equal(lastRoutes!.release(), false); // nothing left to release
    const next = call("POST", "/run", { body: '{"line":"slow"}' });
    await new Promise((r) => setTimeout(r, 10));
    stuck[0]!(); // the old run ends now; the new one must still count as running
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await call("POST", "/run", { body: '{"line":"third"}' })).status, 409);
    assert.equal((await next).status, 504); // 30 ms limit, the run needs 80
  });
});

test("the routes work without the URL and URLSearchParams globals (Live's Extension Host has neither)", async () => {
  const saved = { URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams };
  let asked = 0;
  await withServer({ logLines: (n) => ((asked = n), ["a"]) }, async (call) => {
    // The test client needs the globals itself: take them away only while the server handles the request.
    const routes = lastRoutes!;
    const answers: Array<{ status: number; body: string }> = [];
    const fakeRes = () => {
      const res = { status: 0, body: "", writeHead(status: number) { res.status = status; return res; }, end(body?: string) { res.body = body ?? ""; answers.push({ status: res.status, body: res.body }); return res; } };
      return res;
    };
    delete (globalThis as { URL?: unknown }).URL;
    delete (globalThis as { URLSearchParams?: unknown }).URLSearchParams;
    try {
      const get = { method: "GET", url: "/log?n=9", headers: { authorization: `Bearer ${TOKEN}` } };
      assert.equal(routes(get as never, fakeRes() as never), true);
      assert.equal(routes({ method: "GET", url: "/other", headers: {} } as never, fakeRes() as never), false);
    } finally {
      Object.assign(globalThis, saved);
    }
    assert.equal(answers[0]!.status, 200);
    assert.equal(asked, 9);
    void call;
  });
});

test("splitUrl and queryValue", () => {
  assert.deepEqual(splitUrl("/log?n=5#x"), ["/log", "n=5"]);
  assert.deepEqual(splitUrl("/run"), ["/run", ""]);
  assert.deepEqual(splitUrl(undefined), ["/", ""]);
  assert.equal(queryValue("a=1&n=7", "n"), "7");
  assert.equal(queryValue("n", "n"), "");
  assert.equal(queryValue("m=1", "n"), undefined);
});
