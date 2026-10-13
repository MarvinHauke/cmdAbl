import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { parse } from "../../core/parse.js";
import { ExitCode, type CommandResult } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

let id = 0;
const make = (kind: ObjectNode["kind"], name: string, children: ObjectNode[] = []): ObjectNode =>
  ({ handleId: String(++id), kind, scope: "regular", route: [id], name, path: `/${name}`, children }) as ObjectNode;
const kick = make("chain", "Kick");
const rack = make("device", "Drum Rack", [kick]);
const vermona = make("track", "Vermona MIDI", [rack]);
const lead = make("track", "Lead");
const flat = (ns: ObjectNode[]): ObjectNode[] => ns.flatMap((n) => [n, ...flat(n.children)]);

function setup(nodes: ObjectNode[]) {
  const fake = createFakeApi({ nodes });
  activate(fake.api);
  const cmd = fake.commands[0]!;
  const run = async (options: Record<string, string | true>, start?: ObjectNode) =>
    (await cmd.run!({ path: ["tree"], options, args: [start ? [start] : []] } as never, undefined as never)) as CommandResult;
  return { fake, cmd, run };
}

test("tree: no argument lists the whole Set to depth 2 and needs no script", async () => {
  const { cmd, run, fake } = setup(flat([vermona, lead]));
  assert.equal(cmd.requires, undefined);
  const result = await run({});
  assert.equal(result.code, ExitCode.OK);
  assert.equal(
    result.message,
    "Live Set\n  Vermona MIDI  (track)\n    Drum Rack  (rack)\n  Lead  (track)\n2 tracks, 1 device, 0 chains",
  );
  assert.equal(fake.bridge.calls.length, 0);
});

test("tree: -L changes the depth, a path starts the listing there", async () => {
  const { run } = setup(flat([vermona, lead]));
  const deep = (await run({ level: "3" })).message ?? "";
  assert.ok(deep.includes("      Kick  (chain)"));
  assert.ok(deep.endsWith("2 tracks, 1 device, 1 chain"));
  assert.equal((await run({ level: "1" })).message, "Live Set\n  Vermona MIDI  (track)\n  Lead  (track)\n2 tracks, 0 devices, 0 chains");
  assert.equal(
    (await run({}, vermona)).message,
    "/Vermona MIDI\n  Drum Rack  (rack)\n    Kick  (chain)\n0 tracks, 1 device, 1 chain",
  );
});

test("tree: an empty Set answers with zero counts", async () => {
  const { run } = setup([]);
  assert.equal((await run({})).message, "Live Set\n  (nothing below)\n0 tracks, 0 devices, 0 chains");
});

test("tree: -L must be a whole number from 1 to 12 (the platform rejects the rest with exit 2)", () => {
  const { fake } = setup([]);
  for (const line of ["tree -L 3", "tree --level=1", "tree -L 12 /a"]) {
    assert.equal(parse(line, fake.commands).kind, "run", line);
  }
  for (const line of ["tree -L 0", "tree -L 13", "tree -L 1.5", "tree -L two"]) {
    const outcome = parse(line, fake.commands);
    assert.equal(outcome.kind, "error", line);
    if (outcome.kind === "error") assert.equal(outcome.result.code, ExitCode.USAGE, line);
  }
});
