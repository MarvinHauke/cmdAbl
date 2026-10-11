import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPICS, findTopic, topicList, topicNames } from "./topics.js";

test("both manuals are https and known by name", () => {
  assert.deepEqual(topicNames(), ["ableton", "cmdabl"]);
  assert.equal(findTopic("ableton")?.url, "https://www.ableton.com/en/manual/");
  assert.equal(findTopic("cmdabl")?.url, "https://marvinhauke.github.io/cmdAbl/");
  for (const t of Object.values(TOPICS)) assert.ok(t.url.startsWith("https://"));
});

test("lookup is case-insensitive", () => {
  assert.equal(findTopic("Ableton"), TOPICS["ableton"]);
  assert.equal(findTopic("CMDABL"), TOPICS["cmdabl"]);
});

test("unknown topics and inherited object keys are not found", () => {
  assert.equal(findTopic("nope"), undefined);
  assert.equal(findTopic(""), undefined);
  assert.equal(findTopic("constructor"), undefined);
  assert.equal(findTopic("__proto__"), undefined);
});

test("topicList is comma separated", () => {
  assert.equal(topicList(), "ableton, cmdabl");
});
