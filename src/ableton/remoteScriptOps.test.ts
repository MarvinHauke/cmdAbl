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

import { REMOTE_SCRIPT_ROUTE_LOM } from "./remoteScriptOps.js";

// The Python sources are scanned for what they touch on LOM objects: every attribute that is read
// from a LOM variable, plus names passed to getattr/_flag. Cheap, not a parser: it keeps the
// declared `lom` lists honest in both directions.
const sources = ["routes.py", "ops/select.py", "ops/tracks.py", "ops/chains.py", "ops/tags.py", "ops/params.py", "ops/setid.py"].map((f) =>
  readFileSync(new URL(`../../remote-script/cmdAbl/${f}`, import.meta.url), "utf8"),
);
const code = sources.join("\n").replace(/"""[\s\S]*?"""/g, "").replace(/#.*$/gm, "");
const NOT_LOM = new Set(["get", "append", "items"]);

// NOTE: only variables named below are seen. A handler that names a LOM object differently
// (`pad`, `parent`, …) passes unnoticed: extend the variable list in this regex with the new op.
function usedAttributes(): Set<string> {
  const used = new Set<string>();
  for (const m of code.matchAll(/\b(?:track|chain|device|rack|view|song|group|current|target|param)((?:\.\w+)+)/g)) {
    for (const part of m[1]!.split(".").filter(Boolean)) used.add(part);
  }
  for (const m of code.matchAll(/(?:getattr|setattr|_flag)\(\w+, "(\w+)"/g)) used.add(m[1]!);
  return new Set([...used].filter((n) => !NOT_LOM.has(n)));
}

const declared = new Set([...REMOTE_SCRIPT_ROUTE_LOM, ...REMOTE_SCRIPT_OPS.flatMap((o) => o.lom)].map((u) => u.property));
// Dict keys / loop variables that look like attributes but are wire fields, not LOM members:
const WIRE_ONLY = new Set(["mute", "solo"]); // chain_set reads them via `for key in ("mute", "solo")` + setattr(chain, key, ...)

test("every LOM member the script sources touch is declared", () => {
  const missing = [...usedAttributes()].filter((n) => !declared.has(n));
  assert.deepEqual(missing, []);
});

test("every declared LOM member still appears in the script sources", () => {
  const stale = [...declared].filter((n) => !new RegExp(`\\b${n}\\b`).test(code) && !WIRE_ONLY.has(n));
  assert.deepEqual(stale, []);
});

test("every LOM entry names a page and a known access", () => {
  const pages: Record<string, string> = {
    Song: "song", "Song.View": "song_view", Track: "track", "Track.View": "track_view", Device: "device",
    RackDevice: "rackdevice", "RackDevice.View": "rackdevice_view", Chain: "chain", DrumChain: "drumchain", MixerDevice: "mixerdevice", DeviceParameter: "deviceparameter",
  };
  for (const u of [...REMOTE_SCRIPT_ROUTE_LOM, ...REMOTE_SCRIPT_OPS.flatMap((o) => o.lom)]) {
    assert.equal(pages[u.object], u.page, `${u.object}.${u.property}`);
    assert.ok(["get", "set", "call"].includes(u.access));
  }
  for (const op of REMOTE_SCRIPT_OPS) assert.equal(op.via, "script");
});
