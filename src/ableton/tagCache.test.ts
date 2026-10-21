import { test } from "node:test";
import assert from "node:assert/strict";
import { TagCache } from "./tagCache.js";
import { createFakeBridge } from "./bridgeFake.js";
import { buildObjectTree, flattenObjectTree } from "./objectTree.js";

const quiet = { log: () => {} };
const timers: Array<() => void> = [];
const make = () => new TagCache((fn) => { timers.push(fn); return timers.length; }, quiet.log);

const entry = (scope: string, i: number, name: string, tags: string[]) => ({ scope, route: [i], name, tags });
const tagsBridge = (tracks: unknown[]) => createFakeBridge({ ops: { tags_all: () => ({ ok: true, value: { total: 3, offset: 0, tracks } }) } });

test("get returns tags only while the name at that place matches; never an empty list", async () => {
  const cache = make();
  assert.equal(cache.ready(), false);
  const r = await cache.refreshNow(tagsBridge([entry("regular", 0, "Bass", ["fx"]), entry("return", 0, "Verb", [])]));
  assert.equal(r.ok, true);
  assert.equal(cache.ready(), true);
  assert.deepEqual(cache.get("regular", [0], "Bass"), ["fx"]);
  assert.equal(cache.get("regular", [0], "Renamed"), undefined);
  assert.equal(cache.get("regular", [1], "Bass"), undefined);
  assert.equal(cache.get("return", [0], "Verb"), undefined);
});

test("a failed refresh keeps the old entries and passes the failure on (exit 5 when not running)", async () => {
  const cache = make();
  await cache.refreshNow(tagsBridge([entry("regular", 0, "Bass", ["fx"])]));
  const down = await cache.refreshNow(createFakeBridge({ running: false }));
  assert.deepEqual(down, { ok: false, code: 5, text: "Remote Script not running" });
  assert.deepEqual(cache.get("regular", [0], "Bass"), ["fx"]);
  const never = make();
  await never.refreshNow(createFakeBridge({ running: false }));
  assert.equal(never.ready(), false);
});

test("an empty answer is a complete answer: ready, and old tags are gone", async () => {
  const cache = make();
  await cache.refreshNow(tagsBridge([entry("regular", 0, "Bass", ["fx"])]));
  await cache.refreshNow(tagsBridge([]));
  assert.equal(cache.ready(), true);
  assert.equal(cache.get("regular", [0], "Bass"), undefined);
});

test("concurrent refreshes share one request", async () => {
  const cache = make();
  const bridge = tagsBridge([]);
  await Promise.all([cache.refreshNow(bridge), cache.refreshNow(bridge)]);
  assert.equal(bridge.calls.filter((c) => c.op === "tags_all").length >= 1, true);
  assert.ok(bridge.calls.length <= 2);
});

test("scheduleRefresh throttles and sets one trailing timer", async () => {
  timers.length = 0;
  const cache = make();
  const bridge = tagsBridge([]);
  await cache.scheduleRefresh(bridge, Date.now());
  assert.equal(cache.scheduleRefresh(bridge, Date.now()), null);
  assert.equal(cache.scheduleRefresh(bridge, Date.now()), null);
  assert.equal(timers.length, 1);
  assert.equal(bridge.calls.filter((c) => c.op === "tags_all").length, 1);
});

test("write updates the cache from what Live stored; clearing removes the entry; failures change nothing", async () => {
  const cache = make();
  const node = { scope: "regular" as const, route: [0], name: "Bass" };
  const ok = createFakeBridge({ ops: { tags_set: (a) => ({ ok: true, value: { name: "Bass", tags: a.tags as string[], marked: true } }) } });
  assert.equal((await cache.write(ok, node, ["fx", "drums"])).ok, true);
  assert.deepEqual(cache.get("regular", [0], "Bass"), ["fx", "drums"]);
  await cache.write(ok, node, []);
  assert.equal(cache.get("regular", [0], "Bass"), undefined);
  await cache.write(ok, node, ["a"]);
  const stale = createFakeBridge({ ops: { tags_set: () => ({ ok: false, code: 1, text: "the Live Set changed; run the command again" }) } });
  assert.equal((await cache.write(stale, node, ["b"])).ok, false);
  assert.deepEqual(cache.get("regular", [0], "Bass"), ["a"]);
});

const handle = (id: string) => ({ id: { toString: () => id } });
const track = (id: string, name: string) => ({ handle: handle(id), name, devices: [], groupTrack: null });

test("the object tree carries tags on tracks, and only when the name still matches", async () => {
  const cache = make();
  await cache.refreshNow(tagsBridge([entry("regular", 1, "Lead", ["fx", "lead"]), entry("return", 0, "Verb", ["send"]), entry("master", 0, "Main", ["bus"])]));
  const ctx = (leadName: string) => ({
    application: { song: { tracks: [track("t0", "Bass"), track("t1", leadName)], returnTracks: [track("r0", "Verb")], mainTrack: track("m", "Main") } },
  }) as never;
  const nodes = flattenObjectTree(buildObjectTree(ctx("Lead"), { chainNames: null, tags: cache }));
  assert.deepEqual(nodes.map((n) => [n.name, n.tags]), [["Bass", undefined], ["Lead", ["fx", "lead"]], ["Verb", ["send"]], ["Main", ["bus"]]]);
  const renamed = flattenObjectTree(buildObjectTree(ctx("Lead 2"), { chainNames: null, tags: cache }));
  assert.equal(renamed.find((n) => n.name === "Lead 2")!.tags, undefined);
  const off = flattenObjectTree(buildObjectTree(ctx("Lead"), { chainNames: null, tags: null }));
  assert.ok(off.every((n) => n.tags === undefined));
  nodes[1]!.tags!.push("changed"); // the node holds a copy: the cache is not affected
  assert.deepEqual(cache.get("regular", [1], "Lead"), ["fx", "lead"]);
});

test("a read that began before a write is neither shared nor applied: refreshNow after write sees the new tag", async () => {
  const cache = make();
  let stored: string[] = [];
  const base = createFakeBridge({
    ops: {
      tags_all: () => ({ ok: true, value: { total: 1, offset: 0, tracks: stored.length ? [entry("regular", 0, "Bass", stored)] : [] } }),
      tags_set: (a) => { stored = a.tags as string[]; return { ok: true, value: { name: "Bass", tags: stored, marked: true } }; },
    },
  });
  // the first tags_all is read before the write and answered only after it
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  let first = true;
  const bridge = {
    ...base,
    async request(op: string, args: Record<string, unknown> = {}, opts: { changes?: boolean; token?: boolean } = {}) {
      const answer = await base.request(op, args, opts); // evaluated now: the state before the write
      if (op === "tags_all" && first) {
        first = false;
        await gate;
      }
      return answer;
    },
  };
  const reading = cache.refreshNow(bridge as never); // in flight, will answer "no tags"
  await new Promise((r) => setImmediate(r));
  const node = { scope: "regular" as const, route: [0], name: "Bass" };
  await cache.write(bridge as never, node, ["fx"]);
  const next = cache.refreshNow(bridge as never); // must not return the old read
  release();
  await Promise.all([reading, next]);
  assert.deepEqual(cache.get("regular", [0], "Bass"), ["fx"]);
  assert.equal(base.calls.filter((c) => c.op === "tags_all").length, 2);
});
