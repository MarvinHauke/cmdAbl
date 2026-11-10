import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { appPathFromExecPath, findLivePid, helperArgs, quitArgs, restartLive, HELPER_SCRIPT } from "./restart.js";
import { ExitCode } from "../types.js";

const APP = "/Applications/Ableton Live 12 Beta.app";
const EXEC = `${APP}/Contents/Helpers/ExtensionHost/node`;

test("app path from execPath", () => {
  assert.equal(appPathFromExecPath(EXEC), APP);
  assert.equal(appPathFromExecPath("/usr/local/bin/node"), null);
  assert.equal(appPathFromExecPath("C:\\Program Files\\Ableton\\node.exe"), null);
});

test("Live's pid: exact executable path only, other Lives and helpers do not match", () => {
  const ps = [
    "  100 /usr/bin/foo",
    `  200 ${APP}/Contents/Helpers/ExtensionHost/node host.js`,
    `  300 /Applications/Ableton Live 12 Suite.app/Contents/MacOS/Live`,
    `  400 ${APP}/Contents/MacOS/Live Helper`,
    `  500 ${APP}/Contents/MacOS/Live`,
  ].join("\n");
  assert.equal(findLivePid(ps, APP), 500);
  assert.equal(findLivePid(ps, "/Applications/Ableton Live 12 Suite.app"), 300);
  assert.equal(findLivePid("  1 x", APP), null);
});

test("argv: paths and pid are arguments, never in the script text", () => {
  const h = helperArgs(APP, 500);
  assert.deepEqual(h.slice(2), ["sh", APP, "500"]);
  assert.ok(!HELPER_SCRIPT.includes(APP));
  assert.ok(!quitArgs(APP).slice(0, -1).some((a) => a.includes(APP)));
  assert.equal(quitArgs(APP).at(-1), APP);
});

interface Call { command: string; args: string[]; detached?: boolean }
function fakeSpawn(osaExit: number | "hang" | "error") {
  const calls: Call[] = [];
  const spawn = ((command: string, args: string[], options: { detached?: boolean }) => {
    calls.push({ command, args, detached: options.detached });
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    (child as { pid?: number }).pid = 999999;
    (child as { stderr?: EventEmitter }).stderr = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => {
      if (command === "/bin/sh") child.emit("spawn");
      else if (osaExit === "error") child.emit("error", new Error("ENOENT"));
      else if (osaExit !== "hang") {
        if (osaExit !== 0) child.stderr!.emit("data", "not allowed");
        child.emit("exit", osaExit);
      }
    });
    return child;
  }) as never;
  return { calls, spawn };
}
const base = { platform: "darwin", execPath: EXEC, listProcesses: async () => `  500 ${APP}/Contents/MacOS/Live\n`, graceMs: 20 };

test("restart: helper first (detached), then osascript; a quit still waiting is ok", async () => {
  const f = fakeSpawn("hang");
  const r = await restartLive({ ...base, spawn: f.spawn });
  assert.equal(r.code, ExitCode.OK);
  assert.deepEqual(f.calls.map((c) => c.command), ["/bin/sh", "/usr/bin/osascript"]);
  assert.equal(f.calls[0]!.detached, true);
  assert.deepEqual(f.calls[0]!.args.slice(-2), [APP, "500"]);
});

test("restart: results, not throws", async () => {
  assert.equal((await restartLive({ ...base, platform: "win32" })).code, ExitCode.UNAVAILABLE);
  assert.equal((await restartLive({ ...base, execPath: "/usr/bin/node" })).code, ExitCode.UNAVAILABLE);
  assert.equal((await restartLive({ ...base, listProcesses: async () => "" })).code, ExitCode.NOT_FOUND);
  assert.equal((await restartLive({ ...base, listProcesses: async () => { throw new Error("ps"); } })).code, ExitCode.FAILURE);
  const denied = await restartLive({ ...base, spawn: fakeSpawn(1).spawn });
  assert.equal(denied.code, ExitCode.FAILURE);
  assert.match(denied.message ?? "", /not allowed/);
  assert.equal((await restartLive({ ...base, spawn: fakeSpawn("error").spawn })).code, ExitCode.FAILURE);
  assert.equal((await restartLive({ ...base, spawn: (() => { throw new Error("boom"); }) as never })).code, ExitCode.FAILURE);
});

test("restart: a quit that fails after the grace time still stops the helper", async () => {
  const f = fakeSpawn("hang");
  const killed: unknown[] = [];
  const realKill = process.kill;
  process.kill = ((pid: number) => (killed.push(pid), true)) as never;
  try {
    let quit: EventEmitter | undefined;
    const spawn = ((c: string, a: string[], o: never) => {
      const child = (f.spawn as (...x: unknown[]) => EventEmitter)(c, a, o);
      if (c !== "/bin/sh") quit = child;
      return child;
    }) as never;
    assert.equal((await restartLive({ ...base, spawn })).code, ExitCode.OK);
    quit!.emit("exit", 1);
    assert.deepEqual(killed, [999999]);
  } finally {
    process.kill = realKill;
  }
});

test("`setup restart` refuses in a headless run and never reaches the restart", async () => {
  const { setupCommand } = await import("./command.js");
  let called = 0;
  const steps = { restart: async () => (called++, (await import("../types.js")).ok()) };
  const run = (headless: boolean) => (setupCommand({ headless: () => headless, steps }).run as (i: unknown) => Promise<{ code: number }>)({ args: [["restart"]], options: {}, values: {} });
  assert.equal((await run(true)).code, ExitCode.UNAVAILABLE);
  assert.equal(called, 0);
  assert.equal((await run(false)).code, ExitCode.OK);
  assert.equal(called, 1);
});
