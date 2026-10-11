import { test } from "node:test";
import assert from "node:assert/strict";
import { isHttpsUrl } from "../../core/openUrl.js";
import { TOPICS, abletonSearchUrl, encodeQuery, findTopic, topicList, topicNames } from "./topics.js";

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

const SCOPE = "site:ableton.com inurl:live-manual";
const queryOf = (url: string): string => decodeURIComponent(url.slice("https://duckduckgo.com/?q=".length));

test("ableton has a search, cmdabl has none", () => {
  assert.equal(typeof findTopic("ableton")?.search, "function");
  assert.equal(findTopic("cmdabl")?.search, undefined);
});

test("search builds a DuckDuckGo query scoped to the manual", () => {
  const url = abletonSearchUrl(["warp", "modes"]);
  assert.equal(url, "https://duckduckgo.com/?q=warp%20modes%20site%3Aableton.com%20inurl%3Alive-manual");
  assert.equal(queryOf(url), `warp modes ${SCOPE}`);
  assert.ok(isHttpsUrl(url));
});

test("search collapses whitespace in the typed words", () => {
  assert.equal(queryOf(abletonSearchUrl(["  warp", "", "modes  "])), `warp modes ${SCOPE}`);
});

test("awkward characters survive and the URL stays acceptable to isHttpsUrl", () => {
  const typed = `it's "x" & y # z + (Sättigung)! *`;
  const url = abletonSearchUrl([typed]);
  assert.ok(isHttpsUrl(url), url);
  assert.ok(!/['"!()*&# +]/.test(url.slice("https://duckduckgo.com/?q=".length)));
  assert.equal(queryOf(url), `${typed} ${SCOPE}`);
});

test("encodeQuery also encodes ! ' ( ) *", () => {
  assert.equal(encodeQuery("!'()*"), "%21%27%28%29%2A");
});
