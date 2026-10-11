import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { openUrl } from "./openUrl.js";
import { ExitCode } from "../types.js";

function fakeSpawn(event: "spawn" | "error") {
  const calls: { command: string; args: string[] }[] = [];
  const spawn = (command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    setImmediate(() => (event === "error" ? child.emit("error", new Error("no such file")) : child.emit("spawn")));
    return child as unknown as ChildProcess;
  };
  return { calls, spawn };
}

test("openUrl: not macOS → exit 5 with the URL, nothing spawned", async () => {
  const { calls, spawn } = fakeSpawn("spawn");
  const result = await openUrl("https://example.invalid/manual", { platform: "win32", spawn });
  assert.equal(result.code, ExitCode.UNAVAILABLE);
  assert.match(result.message ?? "", /https:\/\/example\.invalid\/manual/);
  assert.equal(calls.length, 0);
});

test("openUrl: anything but https is refused before any spawn", async () => {
  for (const url of ["http://example.invalid", "file:///etc/passwd", "javascript:alert(1)", "-a Calculator", "not a url"]) {
    const { calls, spawn } = fakeSpawn("spawn");
    const result = await openUrl(url, { platform: "darwin", spawn });
    assert.equal(result.code, ExitCode.FAILURE, url);
    assert.equal(calls.length, 0, url);
  }
});

test("openUrl: macOS runs `open` and a launch error becomes a result", async () => {
  const good = fakeSpawn("spawn");
  assert.equal((await openUrl("https://example.invalid/", { platform: "darwin", spawn: good.spawn })).code, ExitCode.OK);
  assert.deepEqual(good.calls, [{ command: "open", args: ["https://example.invalid/"] }]);

  const bad = fakeSpawn("error");
  const result = await openUrl("https://example.invalid/", { platform: "darwin", spawn: bad.spawn });
  assert.equal(result.code, ExitCode.FAILURE);
});
