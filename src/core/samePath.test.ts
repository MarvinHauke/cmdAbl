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
