import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameDirectory } from "./samePath.js";

test("isSameDirectory: compares real paths and never throws", () => {
  const links: Record<string, string> = { "/lib/cmdAbl": "/repo/remote-script/cmdAbl", "/repo/remote-script/cmdAbl": "/repo/remote-script/cmdAbl", "/other": "/other" };
  const realpath = (p: string) => {
    const real = links[p];
    if (real === undefined) throw new Error("ENOENT");
    return real;
  };
  assert.equal(isSameDirectory("/lib/cmdAbl", "/repo/remote-script/cmdAbl", realpath), true);
  assert.equal(isSameDirectory("/other", "/repo/remote-script/cmdAbl", realpath), false);
  assert.equal(isSameDirectory("/missing", "/repo/remote-script/cmdAbl", realpath), false);
});

test("isSameDirectory: a denied read (sandbox) falls back to the shell comparison, other failures do not", () => {
  const denied = Object.assign(new Error("denied"), { code: "ERR_ACCESS_DENIED" });
  const calls: Array<[string, string]> = [];
  const viaShell = (a: string, b: string) => (calls.push([a, b]), true);
  const deny = () => {
    throw denied;
  };
  assert.equal(isSameDirectory("/a", "/b", deny, viaShell, "darwin"), true);
  assert.deepEqual(calls, [["/a", "/b"]]);
  assert.equal(isSameDirectory("/a", "/b", deny, () => false, "darwin"), false);
  assert.equal(isSameDirectory("/a", "/b", deny, viaShell, "win32"), false);
  const missing = () => {
    throw Object.assign(new Error("gone"), { code: "ENOENT" });
  };
  assert.equal(isSameDirectory("/a", "/b", missing, viaShell, "darwin"), false);
  assert.equal(calls.length, 1);
});

test("sameFileViaShell: the real shell agrees for a link and for different folders", async () => {
  const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "cmdabl-same-"));
  try {
    mkdirSync(join(root, "real"));
    mkdirSync(join(root, "other"));
    symlinkSync(join(root, "real"), join(root, "link"));
    const { sameFileViaShell } = await import("./samePath.js");
    assert.equal(sameFileViaShell(join(root, "link"), join(root, "real")), true);
    assert.equal(sameFileViaShell(join(root, "other"), join(root, "real")), false);
    assert.equal(sameFileViaShell(join(root, "missing"), join(root, "real")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
