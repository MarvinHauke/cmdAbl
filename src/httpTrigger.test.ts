import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { startTriggerServer } from "./httpTrigger.js";

/** A port that is free on 127.0.0.1 right now. */
async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  return port;
}
const settle = () => new Promise((r) => setTimeout(r, 150));
const ipv6Works = async (): Promise<boolean> => {
  const probe = http.createServer();
  return new Promise((resolve) => {
    probe.on("error", () => resolve(false));
    probe.listen(0, "::1", () => probe.close(() => resolve(true)));
  });
};
const request = (host: string, port: number, path: string) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    http.get({ host, port, path, headers: { Host: `localhost:${port}` } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    }).on("error", reject);
  });

test("live pages are served on 127.0.0.1 and [::1], and ::1 serves ONLY the live routes", async () => {
  const port = await freePort();
  const seen: string[] = [];
  const live = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (!req.url?.startsWith("/live/")) return false;
    seen.push(req.url);
    res.writeHead(200).end("live");
    return true;
  };
  const server = startTriggerServer(port, () => seen.push("open"), () => false, undefined, undefined, undefined, live);
  try {
    await settle();
    assert.equal(server.listening(), true);
    assert.equal((await request("127.0.0.1", port, "/live/x")).text, "live");
    if (await ipv6Works()) {
      assert.equal((await request("::1", port, "/live/x")).text, "live");
      assert.equal((await request("::1", port, "/open")).status, 404); // nothing else is served there
      assert.equal((await request("::1", port, "/state")).status, 404);
      assert.ok(!seen.includes("open"));
    }
    assert.equal((await request("127.0.0.1", port, "/state")).text, "closed"); // the normal routes stay on 127.0.0.1
  } finally {
    server.close();
  }
});

test("someone else holds [::1]:port: listening() is false, so live pages fall back to a data page", async () => {
  if (!(await ipv6Works())) return; // no IPv6 here: nobody can hold ::1 either, and the live pages work (see above)
  const port = await freePort();
  const squatter = http.createServer((_req, res) => res.writeHead(200).end("not ours"));
  await new Promise<void>((r) => squatter.listen(port, "::1", r));
  const server = startTriggerServer(port, () => {}, () => false, undefined, undefined, undefined, () => true);
  try {
    await settle();
    assert.equal(server.listening(), false);
  } finally {
    server.close();
    await new Promise((r) => squatter.close(r));
  }
});

test("a taken 127.0.0.1 port means no live pages either; without a live handler nothing extra is bound", async () => {
  const port = await freePort();
  const squatter = http.createServer();
  await new Promise<void>((r) => squatter.listen(port, "127.0.0.1", r));
  const taken = startTriggerServer(port, () => {}, () => false, undefined, undefined, undefined, () => true);
  await settle();
  assert.equal(taken.listening(), false);
  taken.close();
  await new Promise((r) => squatter.close(r));
  const plain = startTriggerServer(await freePort(), () => {}, () => false);
  try {
    await settle();
    assert.equal(plain.listening(), true);
  } finally {
    plain.close();
  }
});
