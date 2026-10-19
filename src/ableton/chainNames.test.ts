import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainNameCache, findRacks, REFRESH_INTERVAL_MS, UNAVAILABLE_INTERVAL_MS, type DeviceLike, type SongLike } from "./chainNames.js";
import { createFakeBridge } from "./bridgeFake.js";

type ChainSpec = { handle: { id: { toString(): string } }; devices: DeviceLike[] };
const ch = (id: string, devices: DeviceLike[] = []): ChainSpec => ({ handle: { id: { toString: () => id } }, devices });
const dev = (id: string, name: string, chains?: ChainSpec[]): DeviceLike => ({
  handle: { id: { toString: () => id } },
  name,
  chains,
});

const song = (): SongLike => ({
  tracks: [
    { devices: [dev("d1", "EQ"), dev("r1", "Drum Rack", [ch("c1", [dev("x", "External Instrument")]), ch("c2")])] },
    { devices: [dev("r2", "Rack", [ch("c3", [dev("r3", "Inner", [ch("c4")])])])] },
  ],
  returnTracks: [{ devices: [dev("r4", "Return Rack", [])] }],
  mainTrack: { devices: [] },
});

test("findRacks lists racks with their route and chain count, nested ones included", () => {
  assert.deepEqual(findRacks(song()), [
    { scope: "regular", route: [0, 1], handleId: "r1", chainIds: ["c1", "c2"] },
    { scope: "regular", route: [1, 0], handleId: "r2", chainIds: ["c3"] },
    { scope: "regular", route: [1, 0, 0, 0], handleId: "r3", chainIds: ["c4"] },
    { scope: "return", route: [0, 0], handleId: "r4", chainIds: [] },
  ]);
});

function scripted(names: Record<string, string[]>) {
  let requests = 0;
  const bridge = createFakeBridge({
    ops: {
      chains: (a) => {
        requests++;
        const targets = a.targets as Array<{ route: number[] }>;
        return {
          ok: true,
          value: {
            racks: targets.map((t) => {
              const list = names[t.route.join(".")];
              if (!list) return { error: { code: "unsupported", text: "x" } };
              return { kind: "drum", total: list.length, offset: 0, chains: list.map((name) => ({ name })) };
            }),
          },
        };
      },
    },
  });
  return { bridge, requests: () => requests };
}

test("refresh fills the cache in one request; get requires the same handle and chain count", async () => {
  const racks = findRacks(song());
  const { bridge, requests } = scripted({ "0.1": ["Kick", "Snare"], "1.0": ["Layer"], "1.0.0.0": ["Only"] });
  const cache = new ChainNameCache();
  await cache.refresh(racks, bridge);
  assert.equal(requests(), 1);
  assert.deepEqual(cache.get("regular", [0, 1], "r1", ["c1", "c2"])?.names, ["Kick", "Snare"]);
  assert.equal(cache.get("regular", [0, 1], "r1", ["c1", "c2", "c9"]), null); // the Set grew a chain: absent until refreshed
  assert.equal(cache.get("regular", [0, 1], "r1", ["c2", "c1"]), null); // pads swapped: handles in another order
  assert.equal(cache.get("regular", [0, 1], "r1", ["c1", "c7"]), null); // one chain deleted, another added: same count
  assert.equal(cache.get("regular", [0, 1], "other", ["c1", "c2"]), null); // another rack at that place
  assert.equal(cache.get("return", [0, 0], "r4", []), null); // that rack failed: not cached
});

test("an outer failure keeps the old entries; refresh never throws", async () => {
  const racks = findRacks(song());
  const cache = new ChainNameCache();
  await cache.refresh(racks, scripted({ "0.1": ["Kick", "Snare"] }).bridge);
  await cache.refresh(racks, createFakeBridge({ running: false }));
  assert.deepEqual(cache.get("regular", [0, 1], "r1", ["c1", "c2"])?.names, ["Kick", "Snare"]);
});

test("scheduleRefresh is throttled, never runs twice at once, and backs off while unavailable", async () => {
  const racks = findRacks(song());
  const { bridge, requests } = scripted({ "0.1": ["Kick", "Snare"] });
  const cache = new ChainNameCache();
  const first = cache.scheduleRefresh(racks, bridge, 1000);
  assert.ok(first);
  assert.equal(cache.scheduleRefresh(racks, bridge, 1001), null); // in flight
  await first;
  assert.equal(cache.scheduleRefresh(racks, bridge, 1000 + REFRESH_INTERVAL_MS - 1), null); // too soon
  await cache.scheduleRefresh(racks, bridge, 1000 + REFRESH_INTERVAL_MS);
  assert.equal(requests(), 2);

  const down = createFakeBridge({ running: false });
  await down.available(); // state: unavailable
  const c2 = new ChainNameCache();
  await c2.scheduleRefresh(racks, down, 5000);
  assert.equal(c2.scheduleRefresh(racks, down, 5000 + REFRESH_INTERVAL_MS), null);
  assert.ok(c2.scheduleRefresh(racks, down, 5000 + UNAVAILABLE_INTERVAL_MS));
});

test("a throttled trigger leaves one trailing refresh that bounds the staleness", async () => {
  const racks = findRacks(song());
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const { bridge, requests } = scripted({ "0.1": ["Kick", "Snare"] });
  const cache = new ChainNameCache((fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  });
  await cache.scheduleRefresh(racks, bridge, 1000);
  assert.equal(cache.scheduleRefresh(racks, bridge, 1500), null); // throttled
  assert.equal(cache.scheduleRefresh(racks, bridge, 1600), null); // still only one timer
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.ms, REFRESH_INTERVAL_MS - 500);
  assert.equal(requests(), 1);
});

test("a rack that appears after the first refresh is picked up by the next one", async () => {
  const lines: string[] = [];
  const names: Record<string, string[]> = { "0.1": ["Kick", "Snare"] };
  const { bridge } = scripted(names);
  const cache = new ChainNameCache(undefined, (l) => lines.push(l));
  const s = song();
  await cache.scheduleRefresh(findRacks(s), bridge, 1000);
  assert.equal(cache.get("regular", [1, 0], "r2", ["c3"]), null);
  // the user groups an instrument into an Instrument Rack on track 1 → a new rack handle with two chains
  s.tracks[1]!.devices = [dev("r9", "Instrument Rack", [ch("n1"), ch("n2")])];
  names["1.0"] = ["Organ Softer", "Test chain"];
  await cache.scheduleRefresh(findRacks(s), bridge, 1000 + REFRESH_INTERVAL_MS);
  assert.deepEqual(cache.get("regular", [1, 0], "r9", ["n1", "n2"])?.names, ["Organ Softer", "Test chain"]);
  assert.match(lines.at(-1)!, /chains refresh: \d+ racks asked, \d+ answered, \d+ chain names/);
});

test("the refresh log is one line per change and names the reason a rack was skipped", async () => {
  const lines: string[] = [];
  const racks = findRacks(song());
  const { bridge } = scripted({ "0.1": ["Kick", "Snare"] }); // 1.0 and 1.0.0.0 are errors
  const cache = new ChainNameCache(undefined, (l) => lines.push(l));
  await cache.refresh(racks, bridge);
  await cache.refresh(racks, bridge);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /4 racks asked, 1 answered, 2 chain names; skipped: regular \[1,0\]: Remote Script: x/);
  await cache.refresh(racks, createFakeBridge({ running: false }));
  assert.match(lines.at(-1)!, /request failed \(code 5\)/);
});
