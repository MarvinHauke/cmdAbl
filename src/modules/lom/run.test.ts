import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ExitCode, type CommandResult } from "../../core/types.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

const node = (
  kind: ObjectNode["kind"],
  route: number[],
  path: string,
  scope: ObjectNode["scope"] = "regular",
  children: ObjectNode[] = [],
): ObjectNode => ({ handleId: path, kind, route, scope, name: path.split("/").pop()!, path, children }) as ObjectNode;

async function lom(target: ObjectNode): Promise<CommandResult> {
  const fake = createFakeApi({ nodes: [target] });
  activate(fake.api);
  const cmd = fake.commands[0]!;
  assert.equal(cmd.requires, undefined); // read-only: no Remote Script needed
  const result = await cmd.run!({ path: ["lom"], options: {}, args: [[target]] } as never, undefined as never);
  return result as CommandResult;
}

test("lom: a track answers with its path, LOM path and the track page", async () => {
  const result = await lom(node("track", [4], "/Drums"));
  assert.equal(result.code, ExitCode.OK);
  assert.equal(
    result.message,
    "/Drums\nlive_set tracks 4\nhttps://docs.cycling74.com/apiref/lom/track/",
  );
});

test("lom: a pad inside a rack on a return track", async () => {
  const result = await lom(node("chain", [1, 0, 2], "/Fx/Rack/Kick", "return"));
  assert.equal(
    result.message,
    "/Fx/Rack/Kick\nlive_set return_tracks 1 devices 0 chains 2\nhttps://docs.cycling74.com/apiref/lom/chain/",
  );
});

test("lom: a device with chains is a rack device, a plain one a device, the main track has no index", async () => {
  const chain = node("chain", [0, 1, 0], "/T/Rack/A");
  const rack = await lom(node("device", [0, 1], "/T/Rack", "regular", [chain]));
  assert.match(rack.message ?? "", /live_set tracks 0 devices 1\n.*\/rackdevice\/$/);
  const plain = await lom(node("device", [0, 0], "/T/EQ"));
  assert.match(plain.message ?? "", /\/device\/$/);
  const main = await lom(node("track", [0], "/Main", "master"));
  assert.match(main.message ?? "", /^\/Main\nlive_set master_track\n/);
});
