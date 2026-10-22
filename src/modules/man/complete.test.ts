import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

test("man <command> completes the registered command names and the two manuals", async () => {
  const fake = createFakeApi({});
  fake.api.commands.add({ name: "tag", summary: "tag tracks", run: () => undefined });
  fake.api.commands.add({ name: "vol", summary: "set levels", run: () => undefined });
  activate(fake.api);
  assert.deepEqual(fake.unknownCompleters(), []);
  assert.equal(fake.commands.find((c) => c.name === "man")!.args?.[0]?.complete, "man-topics");
  const rows = (await fake.completers.get("man-topics")!({})) as Array<{ label: string }>;
  assert.deepEqual(rows.map((r) => r.label), ["tag", "vol", "man", "ableton", "cmdabl"]);
});
