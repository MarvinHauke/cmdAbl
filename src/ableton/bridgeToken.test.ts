import { test } from "node:test";
import assert from "node:assert/strict";
import { createBridgeClient, type Transport } from "./bridgeClient.js";
import { createTokenSource, tokenFilePath } from "./bridgeToken.js";
import { TEXT_FORBIDDEN, TEXT_NO_TOKEN, TEXT_NO_WRITES } from "./bridgeProtocol.js";

const T1 = "a".repeat(32);
const T2 = "b".repeat(32);

test("the token file lives under Application Support, outside any repository", () => {
  assert.equal(tokenFilePath("/Users/x"), "/Users/x/Library/Application Support/cmdAbl/bridge-token");
});

test("token source: reads lazily, trims, caches, forgets; unreadable and malformed are exit code 5", () => {
  let reads = 0;
  let content = `${T1}\n`;
  const src = createTokenSource({ platform: "darwin", home: "/h", read: () => { reads++; return content; } });
  assert.equal(reads, 0);
  assert.deepEqual(src.get(), { ok: true, value: T1 });
  src.get();
  assert.equal(reads, 1);
  content = T2;
  src.forget();
  assert.deepEqual(src.get(), { ok: true, value: T2 });

  const missing = createTokenSource({ platform: "darwin", read: () => { throw new Error("EACCES /secret/path"); } });
  assert.deepEqual(missing.get(), { ok: false, code: 5, text: TEXT_NO_TOKEN });
  const odd = createTokenSource({ platform: "darwin", read: () => "not a token" });
  assert.deepEqual(odd.get(), { ok: false, code: 5, text: TEXT_NO_TOKEN });
  const other = createTokenSource({ platform: "win32", read: () => T1 });
  assert.deepEqual(other.get(), { ok: false, code: 5, text: TEXT_NO_WRITES });
});

/** A script that knows `token` and answers hello + a writing op. */
function client(scriptToken: () => string, tokenSource?: ReturnType<typeof createTokenSource>) {
  let listener: (d: string) => void = () => {};
  const sentArgs: Array<Record<string, unknown>> = [];
  const transport: Transport = {
    send(data, done) {
      const r = JSON.parse(data) as { id: string; op: string; args: Record<string, unknown> };
      done(null);
      let reply: object;
      if (r.op === "hello") reply = { v: 1, id: r.id, ok: true, result: { script: "0.5.0", v: 1, ops: ["hello", "chain_set"] } };
      else {
        sentArgs.push(r.args);
        reply = r.args.token === scriptToken()
          ? { v: 1, id: r.id, ok: true, result: { chains: [] } }
          : { v: 1, id: r.id, ok: false, error: { code: "forbidden", text: "missing or wrong access token" } };
      }
      queueMicrotask(() => listener(JSON.stringify(reply)));
    },
    onMessage(l) { listener = l; },
    close() {},
  };
  const bridge = createBridgeClient({ transport, installed: () => ({ status: "current", version: "0.5.0" }), token: tokenSource });
  return { bridge, sentArgs };
}

test("a writing request carries the token; a stale token is re-read once after forbidden", async () => {
  let live = T1;
  let file = T1;
  const src = createTokenSource({ platform: "darwin", read: () => file });
  const { bridge, sentArgs } = client(() => live, src);
  assert.equal((await bridge.request("chain_set", { targets: [] }, { changes: true, token: true })).ok, true);
  assert.equal(sentArgs[0]!.token, T1);
  // Live restarted: the script has a new token, the file too
  live = T2;
  file = T2;
  const r = await bridge.request("chain_set", { targets: [] }, { changes: true, token: true });
  assert.equal(r.ok, true);
  assert.deepEqual(sentArgs.map((a) => a.token), [T1, T1, T2]);
});

test("still forbidden after the re-read → exit code 5 with the access token text, no loop", async () => {
  const src = createTokenSource({ platform: "darwin", read: () => T1 });
  const { bridge, sentArgs } = client(() => T2, src);
  const r = await bridge.request("chain_set", { targets: [] }, { changes: true, token: true });
  assert.deepEqual(r, { ok: false, code: 5, text: TEXT_FORBIDDEN });
  assert.equal(sentArgs.length, 2);
});

test("an unreadable token file or no token source sends nothing and answers exit code 5", async () => {
  const unreadable = createTokenSource({ platform: "darwin", read: () => { throw new Error("EPERM"); } });
  const a = client(() => T1, unreadable);
  assert.deepEqual(await a.bridge.request("chain_set", {}, { changes: true, token: true }), { ok: false, code: 5, text: TEXT_NO_TOKEN });
  assert.equal(a.sentArgs.length, 0);
  const b = client(() => T1, undefined);
  assert.deepEqual(await b.bridge.request("chain_set", {}, { changes: true, token: true }), { ok: false, code: 5, text: TEXT_NO_TOKEN });
});

test("requests without the token flag never read the file or send a token", async () => {
  let reads = 0;
  const src = createTokenSource({ platform: "darwin", read: () => { reads++; return T1; } });
  const { bridge, sentArgs } = client(() => T1, src);
  await bridge.request("chain_set", { x: 1 });
  assert.equal(reads, 0);
  assert.equal("token" in sentArgs[0]!, false);
});
