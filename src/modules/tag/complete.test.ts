import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

const track = (name: string, i: number) => ({ name, path: `/${name}`, kind: "track", scope: "regular", route: [i], handleId: name }) as unknown as ObjectNode;

test("--edit and --rename name a registered completer that lists the Set's tags with their track counts", async () => {
  const fake = createFakeApi({ nodes: [track("Lead", 0), track("Bass", 1)], tags: { Lead: ["fx", "synth"], Bass: ["fx"] } });
  activate(fake.api);
  assert.deepEqual(fake.unknownCompleters(), []);
  const tag = fake.commands.find((c) => c.name === "tag")!;
  assert.equal(tag.options?.find((o) => o.name === "edit")?.complete, "tags");
  assert.equal(tag.options?.find((o) => o.name === "rename")?.complete, "tags");
  const rows = await fake.completers.get("tags")!({});
  assert.deepEqual(rows, [
    { label: "fx", description: "2 tracks" },
    { label: "synth", description: "1 track" },
  ]);
});

test("the tag completer gives no rows for a Set without tags", async () => {
  const fake = createFakeApi({ nodes: [track("Lead", 0)] });
  activate(fake.api);
  assert.deepEqual(await fake.completers.get("tags")!({}), []);
});
