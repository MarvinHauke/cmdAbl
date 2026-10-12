import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REMOTE_SCRIPT_OPS } from "./remoteScriptOps.js";

const py = readFileSync(new URL("../../remote-script/cmdAbl/ops/__init__.py", import.meta.url), "utf8");

function names(block: RegExp, entry: RegExp): string[] {
  const body = block.exec(py)?.[1] ?? "";
  return [...body.matchAll(entry)].map((m) => m[1]!).sort();
}

test("REMOTE_SCRIPT_OPS lists exactly the script's operations (plus hello)", () => {
  const python = names(/OPS = \{([\s\S]*?)\n\}/, /"(\w+)":/g);
  assert.ok(python.length > 0, "found no ops in ops/__init__.py");
  const ts = REMOTE_SCRIPT_OPS.map((o) => o.name).filter((n) => n !== "hello").sort();
  assert.deepEqual(ts, python);
});

test("changesLive matches WRITES", () => {
  const writes = names(/WRITES = frozenset\(\[([^\]]*)\]\)/, /"(\w+)"/g);
  const ts = REMOTE_SCRIPT_OPS.filter((o) => o.changesLive).map((o) => o.name).sort();
  assert.deepEqual(ts, writes);
});
