import { test } from "node:test";
import assert from "node:assert/strict";
import { childEnv } from "./childEnv.js";

// Every value below is a made-up placeholder.
const source = {
  PATH: "/fake/bin",
  HOME: "/fake/home",
  USER: "fakeuser",
  LANG: "xx_XX.UTF-8",
  LC_ALL: "xx_XX.UTF-8",
  TMPDIR: "/fake/tmp",
  https_proxy: "http://proxy.invalid:3128",
  NO_PROXY: "localhost",
  CMDABL_STALE: "1",
  FAKE_SERVICE_API_KEY: "fake",
  SOME_TOKEN: "fake",
  DB_PASSWORD: "fake",
  AWS_SECRET: "fake",
  RANDOM_VAR: "x",
  UNSET: undefined,
};

test("childEnv: the allowlist passes, everything else (CMDABL_* included) is dropped", () => {
  const env = childEnv({}, source, "darwin");
  assert.deepEqual(env, {
    PATH: "/fake/bin",
    HOME: "/fake/home",
    USER: "fakeuser",
    LANG: "xx_XX.UTF-8",
    LC_ALL: "xx_XX.UTF-8",
    TMPDIR: "/fake/tmp",
    https_proxy: "http://proxy.invalid:3128",
    NO_PROXY: "localhost",
  });
});

test("childEnv: secret-shaped names never pass", () => {
  const env = childEnv({}, source, "darwin");
  for (const name of Object.keys(env)) assert.ok(!/KEY|TOKEN|SECRET|PASSWORD/i.test(name), name);
});

test("childEnv: extra wins and is added", () => {
  const env = childEnv({ HOME: "/other", CMDABL_SOURCE: "/a" }, source, "darwin");
  assert.equal(env["HOME"], "/other");
  assert.equal(env["CMDABL_SOURCE"], "/a");
});

test("childEnv: Windows matches names case-insensitively, POSIX does not", () => {
  const win = { Path: "C:\\fake", SYSTEMROOT: "C:\\Windows", Temp: "C:\\t", ProgramFiles: "C:\\pf", FAKE_TOKEN: "x" };
  assert.deepEqual(childEnv({}, win, "win32"), { Path: "C:\\fake", SYSTEMROOT: "C:\\Windows", Temp: "C:\\t", ProgramFiles: "C:\\pf" });
  assert.deepEqual(childEnv({}, { Path: "x", path: "y" }, "darwin"), {});
});

test("childEnv: on Windows an explicit value replaces the same name in another casing", () => {
  const env = childEnv({ PATH: "C:\\mine" }, { Path: "C:\\theirs" }, "win32");
  assert.deepEqual(env, { PATH: "C:\\mine" });
});

test("childEnv: the default source is process.env and leaves it untouched", () => {
  // Compare names only, so a failure can never print an environment value.
  const before = Object.keys(process.env).sort().join("\n");
  const env = childEnv({ CMDABL_X: "1" });
  assert.equal(env["CMDABL_X"], "1");
  assert.ok(Object.keys(env).length <= Object.keys(process.env).length + 1);
  assert.equal(Object.keys(process.env).sort().join("\n"), before);
});
