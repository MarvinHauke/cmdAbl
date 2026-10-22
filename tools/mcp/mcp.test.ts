import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runTokenFilePath } from "../../src/devRoutes.js";
import { createClient, outcomeText } from "./client.js";
import { createServer } from "./server.js";

const TOKEN = "fake-token";

interface Fake {
  port: number;
  requests: Array<{ method: string; url: string; auth: string | undefined; body: string }>;
  close(): Promise<void>;
}

/** A stand-in for the extension's trigger server. `handler` answers (status, body) for a request. */
async function fakeCmdabl(handler: (method: string, url: string, body: string) => { status: number; body: string; delayMs?: number }): Promise<Fake> {
  const requests: Fake["requests"] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      const answer = handler(req.method ?? "", req.url ?? "", body);
      setTimeout(() => res.writeHead(answer.status).end(answer.body), answer.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as { port: number }).port,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

const withToken = { readFile: () => `${TOKEN}\n`, tokenFile: "unused" };

test("run: sends the line with the Bearer token and reads the outcome", async () => {
  const fake = await fakeCmdabl(() => ({ status: 200, body: JSON.stringify({ code: 0, message: "", log: ["cmdAbl [vol] info: Bass -6.0 dB -> -12.0 dB"], dialogs: [], notices: [], ms: 42 }) }));
  try {
    const out = await createClient({ port: fake.port, ...withToken }).run("vol -12 /Bass");
    assert.equal(out.isError, false);
    assert.match(out.text, /^exit 0 \(42 ms\)/);
    assert.match(out.text, /Bass -6\.0 dB -> -12\.0 dB/);
    assert.equal(fake.requests[0]!.method, "POST");
    assert.equal(fake.requests[0]!.url, "/run");
    assert.equal(fake.requests[0]!.auth, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(fake.requests[0]!.body), { line: "vol -12 /Bass" });
  } finally {
    await fake.close();
  }
});

test("run: a non-zero exit code is an answer, with the candidates and the dialog named", async () => {
  const fake = await fakeCmdabl(() => ({ status: 200, body: JSON.stringify({ code: 4, message: "cmdAbl: ambiguous: goto: \"kick\" matches 2", log: [], dialogs: ['pick "goto": /Kick#1, /Kick#2'], notices: [], ms: 3 }) }));
  try {
    const out = await createClient({ port: fake.port, ...withToken }).run("goto kick");
    assert.equal(out.isError, false);
    assert.match(out.text, /^exit 4/);
    assert.match(out.text, /a dialog was needed/);
    assert.match(out.text, /Kick#2/);
  } finally {
    await fake.close();
  }
});

test("nothing listening: says cmdAbl is not running, at once", async () => {
  const fake = await fakeCmdabl(() => ({ status: 200, body: "" }));
  const port = fake.port;
  await fake.close();
  const client = createClient({ port, ...withToken });
  for (const out of [await client.run("x"), await client.log(), await client.bridge(), await client.state()]) {
    assert.equal(out.isError, true);
    assert.match(out.text, /cmdAbl is not running/);
  }
});

test("no token file: says so without calling anything", async () => {
  const fake = await fakeCmdabl(() => ({ status: 200, body: "{}" }));
  try {
    const client = createClient({ port: fake.port, tokenFile: "missing", readFile: () => { throw new Error("ENOENT"); } });
    const out = await client.run("x");
    assert.equal(out.isError, true);
    assert.match(out.text, /no run-token file/);
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
  }
});

test("refusals: busy, timeout, unauthorized, no routes", async () => {
  const cases: Array<[number, string, RegExp]> = [
    [409, JSON.stringify({ error: "busy", reason: "a palette or dialog is open" }), /busy: a palette or dialog is open/],
    [504, JSON.stringify({ error: "timeout", reason: "the run took over 10 s; it may still be going" }), /took over 10 s/],
    [401, JSON.stringify({ error: "unauthorized" }), /refused the token/],
    [404, "", /no test routes/],
  ];
  for (const [status, body, expected] of cases) {
    const fake = await fakeCmdabl(() => ({ status, body }));
    try {
      const out = await createClient({ port: fake.port, ...withToken }).run("x");
      assert.equal(out.isError, true, String(status));
      assert.match(out.text, expected);
    } finally {
      await fake.close();
    }
  }
});

test("a server that does not answer is cut off at the time limit", async () => {
  const fake = await fakeCmdabl(() => ({ status: 200, body: "{}", delayMs: 2000 }));
  try {
    const started = Date.now();
    const out = await createClient({ port: fake.port, timeoutMs: 100, ...withToken }).run("x");
    assert.ok(Date.now() - started < 1500);
    assert.equal(out.isError, true);
    assert.match(out.text, /did not answer/);
  } finally {
    await fake.close();
  }
});

test("log, bridge and state use their routes", async () => {
  const fake = await fakeCmdabl((method, url) => {
    if (url.startsWith("/log")) return { status: 200, body: JSON.stringify({ lines: ["a", "b"] }) };
    if (url === "/bridge") return { status: 200, body: "bridge: 3 ms median" };
    return { status: 200, body: "open" };
  });
  try {
    const client = createClient({ port: fake.port, ...withToken });
    assert.equal((await client.log(7)).text, "a\nb");
    assert.equal(fake.requests[0]!.url, "/log?n=7");
    assert.equal(fake.requests[0]!.auth, `Bearer ${TOKEN}`);
    assert.equal((await client.bridge()).text, "bridge: 3 ms median");
    assert.equal(fake.requests[1]!.auth, undefined); // the read-only routes need no token
    assert.match((await client.state()).text, /^open/);
  } finally {
    await fake.close();
  }
});

test("the token never appears in a returned text", async () => {
  const fake = await fakeCmdabl(() => ({ status: 401, body: "{}" }));
  try {
    const client = createClient({ port: fake.port, ...withToken });
    for (const out of [await client.run("x"), await client.log()]) assert.ok(!out.text.includes(TOKEN));
  } finally {
    await fake.close();
  }
});

test("the MCP server lists the four tools and answers through the client", async () => {
  const fake = await fakeCmdabl((method, url) => (url === "/run" ? { status: 200, body: JSON.stringify({ code: 0, message: "hi", log: [], dialogs: [], notices: [], ms: 1 }) } : { status: 200, body: "closed" }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(createClient({ port: fake.port, ...withToken }));
  const client = new Client({ name: "test", version: "0" });
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["cmdabl_bridge", "cmdabl_log", "cmdabl_run", "cmdabl_state"]);
    const run = (await client.callTool({ name: "cmdabl_run", arguments: { line: "mute /Bass" } })) as { content: Array<{ text: string }>; isError?: boolean };
    assert.match(run.content[0]!.text, /^exit 0/);
    assert.ok(!run.isError);
    const state = (await client.callTool({ name: "cmdabl_state", arguments: {} })) as { content: Array<{ text: string }> };
    assert.match(state.content[0]!.text, /^closed/);
  } finally {
    await client.close();
    await server.close();
    await fake.close();
  }
});

test("outcomeText and the token path", () => {
  assert.equal(outcomeText({ code: 0, ms: 5 }), "exit 0 (5 ms)");
  assert.match(runTokenFilePath("/home/x"), /Extensions Data\/marvinhauke\.cmdabl\/run-token$/);
});
