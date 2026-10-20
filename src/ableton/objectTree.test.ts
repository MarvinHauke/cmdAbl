import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObjectTree, flattenObjectTree } from "./objectTree.js";
import { ChainNameCache } from "./chainNames.js";
import { createFakeBridge } from "./bridgeFake.js";
import { resolvePath } from "./resolvePath.js";

const handle = (id: string) => ({ id: { toString: () => id } });
const chain = (id: string) => ({ handle: handle(id), devices: [] });
const device = (id: string, name: string, chains?: ReturnType<typeof chain>[]) => ({ handle: handle(id), name, ...(chains ? { chains } : {}) });
const track = (id: string, name: string, devices: ReturnType<typeof device>[], groupTrack: unknown = null) => ({
  handle: handle(id), name, devices, groupTrack,
});

function context(chainCount = 3) {
  const rack = device("r1", "Drum Rack", Array.from({ length: chainCount }, (_, i) => chain(`c${i}`)));
  const vermona = track("t1", "Vermona MIDI", [device("d0", "EQ"), rack]);
  return {
    context: { application: { song: { tracks: [vermona], returnTracks: [], mainTrack: track("m", "Main", []) } } } as never,
    rack,
  };
}

async function warmedCache(ctx: ReturnType<typeof context>, names: string[]) {
  const cache = new ChainNameCache();
  const bridge = createFakeBridge({
    ops: { chains: (a) => ({ ok: true, value: { racks: (a.targets as unknown[]).map(() => ({ kind: "drum", total: names.length, offset: 0, chains: names.map((name) => ({ name })) })) } }) },
  });
  await cache.refresh([{ scope: "regular", route: [0, 1], handleId: "r1", chainIds: names.map((_, i) => `c${i}`) }], bridge);
  return cache;
}

test("a cached rack gets chain nodes with real names, routes and paths", async () => {
  const ctx = context();
  const cache = await warmedCache(ctx, ["Kick", "Snare", "Kick"]);
  const nodes = flattenObjectTree(buildObjectTree(ctx.context, { chainNames: cache }));
  const chains = nodes.filter((n) => n.kind === "chain");
  assert.deepEqual(chains.map((n) => [n.path, n.route, n.scope]), [
    ["/Vermona MIDI/Drum Rack/Kick", [0, 1, 0], "regular"],
    ["/Vermona MIDI/Drum Rack/Snare", [0, 1, 1], "regular"],
    ["/Vermona MIDI/Drum Rack/Kick#2", [0, 1, 2], "regular"],
  ]);
  assert.equal(chains[0]!.handleId, "c0");
  assert.deepEqual(resolvePath(nodes, "/vermona midi/drum rack/snare", ["chain"]).map((n) => n.route), [[0, 1, 1]]);
});

test("no cache entry, or a different chain count: no chain nodes, no error", async () => {
  const ctx = context();
  const none = flattenObjectTree(buildObjectTree(ctx.context, { chainNames: new ChainNameCache() }));
  assert.equal(none.filter((n) => n.kind === "chain").length, 0);
  const cache = await warmedCache(ctx, ["Kick", "Snare", "Hat"]);
  const grown = context(4); // the SDK now sees 4 chains
  const nodes = flattenObjectTree(buildObjectTree(grown.context, { chainNames: cache }));
  assert.equal(nodes.filter((n) => n.kind === "chain").length, 0);
  const off = flattenObjectTree(buildObjectTree(ctx.context, { chainNames: null }));
  assert.equal(off.filter((n) => n.kind === "chain").length, 0);
});

test("a swapped pad (same count, other handles) shows no stale names", async () => {
  const ctx = context();
  const cache = await warmedCache(ctx, ["Kick", "Snare", "Hat"]);
  const swapped = context();
  (swapped.rack as { chains: unknown[] }).chains.reverse();
  const nodes = flattenObjectTree(buildObjectTree(swapped.context, { chainNames: cache }));
  assert.equal(nodes.filter((n) => n.kind === "chain").length, 0);
});

test("tracks and devices are unchanged by chain support", async () => {
  const ctx = context();
  const nodes = flattenObjectTree(buildObjectTree(ctx.context, { chainNames: await warmedCache(ctx, ["A", "B", "C"]) }));
  assert.deepEqual(nodes.filter((n) => n.kind !== "chain").map((n) => n.path), ["/Vermona MIDI", "/Vermona MIDI/EQ", "/Vermona MIDI/Drum Rack", "/Main"]);
});

test("a Drum Rack nested in an Instrument Rack chain: its pads are tree nodes with the right routes and paths", async () => {
  const pad = (id: string, devices: object[] = []) => ({ handle: handle(id), devices });
  const drum = { handle: handle("dr"), name: "Kit", chains: [pad("p0", [{ handle: handle("s0"), name: "Kick Caltroit" }]), pad("p1")] };
  const outer = { handle: handle("ir"), name: "Strutter Kit", chains: [{ handle: handle("oc"), devices: [drum] }] };
  const drums = track("t1", "Drums", [outer as never]);
  const ctx = { application: { song: { tracks: [drums], returnTracks: [], mainTrack: track("m", "Main", []) } } } as never;
  const cache = new ChainNameCache();
  const answers: Record<string, string[]> = { "0.0": ["Strutter Kit"], "0.0.0.0": ["Kick Rumble", "Kick Yolo"] };
  const bridge = createFakeBridge({
    ops: {
      chains: (a) => ({
        ok: true,
        value: { racks: (a.targets as Array<{ route: number[] }>).map((t) => ({ kind: "rack", total: answers[t.route.join(".")]!.length, offset: 0, chains: answers[t.route.join(".")]!.map((name) => ({ name })) })) },
      }),
    },
  });
  await cache.refresh(
    [
      { scope: "regular", route: [0, 0], handleId: "ir", chainIds: ["oc"] },
      { scope: "regular", route: [0, 0, 0, 0], handleId: "dr", chainIds: ["p0", "p1"] },
    ],
    bridge,
  );
  const nodes = flattenObjectTree(buildObjectTree(ctx, { chainNames: cache }));
  assert.deepEqual(
    nodes.filter((n) => n.route.length > 1).map((n) => [n.path, n.kind, n.route]),
    [
      ["/Drums/Strutter Kit", "device", [0, 0]],
      ["/Drums/Strutter Kit/Strutter Kit", "chain", [0, 0, 0]],
      ["/Drums/Strutter Kit/Strutter Kit/Kit", "device", [0, 0, 0, 0]],
      ["/Drums/Strutter Kit/Strutter Kit/Kit/Kick Rumble", "chain", [0, 0, 0, 0, 0]],
      ["/Drums/Strutter Kit/Strutter Kit/Kit/Kick Rumble/Kick Caltroit", "device", [0, 0, 0, 0, 0, 0]],
      ["/Drums/Strutter Kit/Strutter Kit/Kit/Kick Yolo", "chain", [0, 0, 0, 0, 1]],
    ],
  );
});
