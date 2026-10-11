import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command } from "../commandRegistry.js";
import { resolvePath } from "../ableton/resolvePath.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import type { ModuleApi } from "./types.js";
import { registerTrackSetCommand } from "./trackSetCommand.js";

const node = (name: string, kind: string, route: number[]): ObjectNode =>
  ({ handleId: name, route, kind, scope: "regular", name, path: `/${name}`, children: [] }) as unknown as ObjectNode;

test("mute/unmute/solo/unsolo/arm/unarm accept tracks only — a chain is never offered", () => {
  const commands: Command[] = [];
  const api = { commands: { add: (c: Command) => commands.push(c) } } as unknown as ModuleApi;
  registerTrackSetCommand(api, "mute", "mute", "toggle", "s");
  registerTrackSetCommand(api, "unmute", "mute", false, "s");
  registerTrackSetCommand(api, "solo", "solo", "toggle", "s");
  registerTrackSetCommand(api, "unsolo", "solo", false, "s");
  registerTrackSetCommand(api, "arm", "arm", "toggle", "s");
  registerTrackSetCommand(api, "unarm", "arm", false, "s");
  assert.equal(commands.length, 6);

  const tree = [node("Kick", "track", [0]), node("Kick", "device", [0, 0]), node("Kick", "chain", [0, 0, 0])];
  for (const c of commands) {
    const def = c.args?.[0];
    assert.deepEqual(def?.kinds, ["track"], c.name);
    // what the platform resolves for such an argument: only the track
    const found = resolvePath(tree, "Kick", def?.kinds);
    assert.deepEqual(found.map((n) => n.kind), ["track"], c.name);
  }
});
