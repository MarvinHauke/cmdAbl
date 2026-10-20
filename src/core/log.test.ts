import { test } from "node:test";
import assert from "node:assert/strict";
import { consoleSink, createLog, LOG_CAPACITY } from "./log.js";

function make() {
  const sunk: Array<[string, string]> = [];
  const log = createLog((line, level) => void sunk.push([line, level]));
  return { log, sunk };
}

test("lines read `cmdAbl [source] level: text`; multi-line text is one entry per line", () => {
  const { log, sunk } = make();
  const l = log.logger("tag");
  l.info("a");
  l.warn("b\n\nc");
  l.error("d");
  assert.deepEqual(log.lines(), ["cmdAbl [tag] info: a", "cmdAbl [tag] warn: b", "cmdAbl [tag] warn: c", "cmdAbl [tag] error: d"]);
  assert.deepEqual(sunk.map(([, level]) => level), ["info", "warn", "warn", "error"]);
});

test("debug lines are dropped until debug is turned on", () => {
  const { log, sunk } = make();
  const l = log.logger("run");
  l.debug("hidden");
  assert.deepEqual(log.lines(), []);
  log.setDebug(true);
  assert.equal(log.debugOn(), true);
  l.debug("shown");
  assert.deepEqual(log.lines(), ["cmdAbl [run] debug: shown"]);
  log.setDebug(false);
  l.debug("hidden again");
  assert.equal(log.lines().length, 1);
  assert.equal(sunk.length, 1);
});

test("the ring buffer keeps the last 500 lines; lines(n) gives the newest n, oldest first", () => {
  const { log } = make();
  const l = log.logger("x");
  for (let i = 0; i < LOG_CAPACITY + 20; i++) l.info(String(i));
  const all = log.lines();
  assert.equal(all.length, LOG_CAPACITY);
  assert.equal(all[0], "cmdAbl [x] info: 20");
  assert.equal(all.at(-1), `cmdAbl [x] info: ${LOG_CAPACITY + 19}`);
  assert.deepEqual(log.lines(2), [`cmdAbl [x] info: ${LOG_CAPACITY + 18}`, `cmdAbl [x] info: ${LOG_CAPACITY + 19}`]);
  assert.deepEqual(log.lines(0), []);
});

test("record keeps a preformatted line; a throwing sink never breaks the caller", () => {
  const log = createLog(() => {
    throw new Error("sink");
  });
  log.record("cmdAbl [run] info: start: x");
  log.logger("a").error("b");
  assert.deepEqual(log.lines(), ["cmdAbl [run] info: start: x", "cmdAbl [a] error: b"]);
});

test("console sink stamps the local time before the prefix", () => {
  const seen: string[] = [];
  const orig = console.log;
  console.log = (l: string) => void seen.push(l);
  try {
    consoleSink("cmdAbl [x] info: hi", "info", new Date(2026, 9, 20, 23, 35, 2, 123).getTime());
  } finally {
    console.log = orig;
  }
  assert.deepEqual(seen, ["23:35:02.123 cmdAbl [x] info: hi"]);
});
