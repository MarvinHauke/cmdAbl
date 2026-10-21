import { test } from "node:test";
import assert from "node:assert/strict";
import { commandListText, groupByTopic, TOPIC_ORDER } from "./topics.js";

const item = (name: string, topic?: string) => ({ name, topic });

test("groupByTopic: topic order, registration order inside, unknown or none last by name, empty topics left out", () => {
  const items = [item("pakabl", "Extensions"), item("zeta"), item("mute", "Mix"), item("goto", "Find and select"), item("alpha", "Nonsense"), item("arm", "Mix")];
  const groups = groupByTopic(items, (i) => i.name, (i) => i.topic);
  assert.deepEqual(groups.map((g) => [g.title, g.items.map((i) => i.name)]), [
    ["Find and select", ["goto"]],
    ["Mix", ["mute", "arm"]],
    ["Extensions", ["pakabl"]],
    ["More commands", ["alpha", "zeta"]],
  ]);
  assert.deepEqual(groupByTopic([], (n: string) => n, () => undefined), []);
});

test("commandListText: a heading per topic, rows indented, a blank line between", () => {
  const text = commandListText([
    { name: "mute", description: "mute tracks", topic: "Mix" },
    { name: "x", description: "other" },
  ]);
  assert.equal(text, "Mix\n  mute         mute tracks\n\nMore commands\n  x            other");
});

test("topics: no topic heading has the anchor of a command heading of the shipped commands", () => {
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const shipped = ["goto", "find", "next", "prev", "mute", "solo", "arm", "tag", "help", "man", "lom", "history", "pakabl", "cmdabl"];
  for (const title of TOPIC_ORDER) assert.ok(!shipped.includes(slug(title)), title);
});
