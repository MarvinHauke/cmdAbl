import { test } from "node:test";
import assert from "node:assert/strict";
import { chains, chunkTargets, select, trackFacts, REQUEST_BYTES_BUDGET, TRACK_FACTS_PER_REQUEST } from "./bridgeOps.js";
import { createFakeBridge } from "./bridgeFake.js";
import { fail } from "./bridgeProtocol.js";

const node = { scope: "regular" as const, route: [2, 1], name: "EQ Eight" };

test("select sends scope, route and expectName and returns the read-back name", async () => {
  const bridge = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "EQ Eight" } }) } });
  assert.deepEqual(await select(bridge, node), { ok: true, value: { name: "EQ Eight" } });
  assert.deepEqual(bridge.calls, [{ op: "select", args: { scope: "regular", route: [2, 1], expectName: "EQ Eight" }, changes: true }]);
});

test("select passes failures through and rejects a reply without a name", async () => {
  const stale = createFakeBridge({ ops: { select: () => fail(1, "the Live Set changed; run the command again") } });
  assert.deepEqual(await select(stale, node), { ok: false, code: 1, text: "the Live Set changed; run the command again" });
  const odd = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: 3 } }) } });
  const r = await select(odd, node);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 1);
  const down = createFakeBridge({ running: false });
  assert.equal((await select(down, node)).ok, false);
});

const facts = (name: string | undefined, o: object = {}) => ({ ...(name === undefined ? {} : { name }), can_be_armed: true, is_foldable: false, is_grouped: false, arm: false, ...o });

test("trackFacts sends all tracks in one request and maps each entry", async () => {
  const bridge = createFakeBridge({
    ops: {
      track_facts: () => ({
        ok: true,
        value: { tracks: [facts("Rytm", { is_foldable: true }), facts("Dead", { can_be_armed: false, arm: null }), { error: { code: "stale", text: "x" } }] },
      }),
    },
  });
  const nodes = [0, 1, 2].map((i) => ({ scope: "regular" as const, route: [i], name: `T${i}` }));
  const r = await trackFacts(bridge, nodes);
  assert.equal(bridge.calls.length, 1);
  assert.deepEqual(bridge.calls[0]!.args, { targets: nodes.map((n) => ({ scope: "regular", route: n.route, expectName: n.name })) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value[0], { ok: true, value: { name: "Rytm", canBeArmed: true, isGroup: true, isGrouped: false, arm: false } });
  assert.deepEqual(r.value[1], { ok: true, value: { name: "Dead", canBeArmed: false, isGroup: false, isGrouped: false, arm: null } });
  assert.deepEqual(r.value[2], { ok: false, code: 1, text: "the Live Set changed; run the command again" });
});

test("trackFacts chunks large lists, rejects malformed replies and passes failures through", async () => {
  let seen: number[] = [];
  const bridge = createFakeBridge({
    ops: { track_facts: (a) => { const t = (a.targets as unknown[]).length; seen.push(t); return { ok: true, value: { tracks: Array.from({ length: t }, () => facts("x")) } }; } },
  });
  const many = Array.from({ length: TRACK_FACTS_PER_REQUEST + 3 }, (_, i) => ({ scope: "regular" as const, route: [i], name: "x" }));
  const r = await trackFacts(bridge, many);
  assert.deepEqual(seen, [TRACK_FACTS_PER_REQUEST, 3]);
  assert.equal(r.ok && r.value.length, TRACK_FACTS_PER_REQUEST + 3);

  const short = createFakeBridge({ ops: { track_facts: () => ({ ok: true, value: { tracks: [] } }) } });
  assert.equal((await trackFacts(short, many.slice(0, 1))).ok, false);
  const odd = createFakeBridge({ ops: { track_facts: () => ({ ok: true, value: { tracks: [{ name: 1 }] } }) } });
  const o = await trackFacts(odd, many.slice(0, 1));
  assert.equal(o.ok && o.value[0]!.ok, false);
  const down = createFakeBridge({ running: false });
  assert.deepEqual((await trackFacts(down, many.slice(0, 1))).ok, false);
});

test("trackFacts fills a left-out name from the node, chunkTargets bounds count and encoded size", async () => {
  const bridge = createFakeBridge({ ops: { track_facts: () => ({ ok: true, value: { tracks: [facts(undefined)] } }) } });
  const r = await trackFacts(bridge, [{ scope: "regular", route: [0], name: "日本語" }]);
  assert.deepEqual(r.ok && r.value[0], { ok: true, value: { name: "日本語", canBeArmed: true, isGroup: false, isGrouped: false, arm: false } });

  const long = Array.from({ length: 15 }, (_, i) => ({ scope: "regular" as const, route: [i], name: "日本語のとても長いトラック名".repeat(5) }));
  const chunks = chunkTargets(long);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    const bytes = Buffer.byteLength(JSON.stringify(c.map((n) => ({ scope: n.scope, route: n.route, expectName: n.name }))), "utf8");
    assert.ok(bytes <= REQUEST_BYTES_BUDGET + c.length, `chunk of ${c.length} is ${bytes} bytes`);
  }
  assert.equal(chunks.flat().length, 15);
});

test("chains asks once per request, merges pages and keeps each rack's failure alone", async () => {
  const calls: Array<Array<{ offset: number }>> = [];
  const all = ["Kick", "Snare", "Hat", "Clap"];
  const bridge = createFakeBridge({
    ops: {
      chains: (a) => {
        const targets = a.targets as Array<{ route: number[]; offset: number }>;
        calls.push(targets.map((t) => ({ offset: t.offset })));
        const racks = targets.map((t) => {
          if (t.route[0] === 9) return { error: { code: "unsupported", text: "not a rack device" } };
          const end = Math.min(t.offset + 2, all.length);
          const e: Record<string, unknown> = {
            kind: "drum",
            total: all.length,
            offset: t.offset,
            chains: all.slice(t.offset, end).map((name, i) => ({ name, note: 36 + t.offset + i })),
          };
          if (end < all.length) e.next = end;
          return e;
        });
        return { ok: true, value: { racks } };
      },
    },
  });
  const r = await chains(bridge, [
    { scope: "regular", route: [0, 0] },
    { scope: "regular", route: [9, 0] },
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value[0], { ok: true, value: { kind: "drum", names: all, notes: [36, 37, 38, 39] } });
  assert.equal(r.value[1]!.ok, false);
  assert.equal(calls.length, 2); // second round only for the paged rack
  assert.deepEqual(calls[1], [{ offset: 2 }]);
});

test("chains rejects malformed replies and passes outer failures through", async () => {
  const odd = createFakeBridge({ ops: { chains: () => ({ ok: true, value: { racks: [{ kind: "rack", total: 1, offset: 0, chains: [{ name: 3 }] }] } }) } });
  const r = await chains(odd, [{ scope: "regular", route: [0, 0] }]);
  assert.equal(r.ok && r.value[0]!.ok, false);
  const short = createFakeBridge({ ops: { chains: () => ({ ok: true, value: { racks: [] } }) } });
  assert.equal((await chains(short, [{ scope: "regular", route: [0, 0] }])).ok, false);
  const down = createFakeBridge({ running: false });
  assert.equal((await chains(down, [{ scope: "regular", route: [0, 0] }])).ok, false);
});
