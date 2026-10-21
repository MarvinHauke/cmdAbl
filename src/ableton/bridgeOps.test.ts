import { test } from "node:test";
import assert from "node:assert/strict";
import { chains, chunkTargets, select, readTags, writeTags, trackFacts, REQUEST_BYTES_BUDGET, TRACK_FACTS_PER_REQUEST } from "./bridgeOps.js";
import { createFakeBridge } from "./bridgeFake.js";
import { fail, TEXT_OUTDATED } from "./bridgeProtocol.js";

const node = { scope: "regular" as const, route: [2, 1], name: "EQ Eight" };

test("select sends scope, route and expectName and returns the read-back name", async () => {
  const bridge = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "EQ Eight" } }) } });
  assert.deepEqual(await select(bridge, node), { ok: true, value: { name: "EQ Eight", isShowingChains: null } });
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
  assert.deepEqual(r.value[0], { ok: true, value: { name: "Rytm", canBeArmed: true, isFoldable: true, isGrouped: false, arm: false } });
  assert.deepEqual(r.value[1], { ok: true, value: { name: "Dead", canBeArmed: false, isFoldable: false, isGrouped: false, arm: null } });
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
  assert.deepEqual(r.ok && r.value[0], { ok: true, value: { name: "日本語", canBeArmed: true, isFoldable: false, isGrouped: false, arm: false } });

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
            chains: all.slice(t.offset, end).map((name, i) => ({ name, in_note: 36 + t.offset + i })),
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
  assert.deepEqual(r.value[0], { ok: true, value: { kind: "drum", names: all, notes: [36, 37, 38, 39], mutes: [false, false, false, false], solos: [false, false, false, false] } });
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

import { chainSet, chainSwitches } from "./bridgeOps.js";

const chainNode = (i: number, name: string) => ({ scope: "regular" as const, route: [0, 1, i], name });

test("chainSwitches reads mute/solo from one chains request and checks the name", async () => {
  const bridge = createFakeBridge({
    ops: {
      chains: () => ({
        ok: true,
        value: { racks: [{ kind: "drum", total: 2, offset: 0, chains: [{ name: "Kick", mute: true }, { name: "Snare", solo: true }] }] },
      }),
    },
  });
  const r = await chainSwitches(bridge, [chainNode(0, "Kick"), chainNode(1, "Snare"), chainNode(1, "Old")]);
  assert.equal(bridge.calls.length, 1);
  assert.deepEqual(bridge.calls[0]!.args, { targets: [{ scope: "regular", route: [0, 1], offset: 0 }] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value[0], { ok: true, value: { name: "Kick", mute: true, solo: false } });
  assert.deepEqual(r.value[1], { ok: true, value: { name: "Snare", mute: false, solo: true } });
  assert.deepEqual(r.value[2], { ok: false, code: 1, text: "the Live Set changed; run the command again" });
});

test("chainSet sends set values with expectName and the token flag, and maps each entry", async () => {
  const bridge = createFakeBridge({
    ops: {
      chain_set: () => ({
        ok: true,
        value: { chains: [{ name: "Kick", mute: true, solo: false }, { error: { code: "stale", text: "name differs" } }] },
      }),
    },
  });
  const r = await chainSet(bridge, [{ ...chainNode(0, "Kick"), mute: true }, { ...chainNode(1, "Snare"), solo: false }]);
  assert.deepEqual(bridge.calls, [{
    op: "chain_set",
    args: { targets: [
      { scope: "regular", route: [0, 1, 0], expectName: "Kick", mute: true },
      { scope: "regular", route: [0, 1, 1], expectName: "Snare", solo: false },
    ] },
    changes: true,
    token: true,
  }]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value[0], { ok: true, value: { name: "Kick", mute: true, solo: false } });
  assert.deepEqual(r.value[1], { ok: false, code: 1, text: "the Live Set changed; run the command again" });
});

test("chainSet rejects malformed replies and passes outer failures through", async () => {
  const odd = createFakeBridge({ ops: { chain_set: () => ({ ok: true, value: { chains: [{ name: "K", mute: "yes", solo: false }] } }) } });
  const r = await chainSet(odd, [{ ...chainNode(0, "K"), mute: true }]);
  assert.equal(r.ok && r.value[0]!.ok, false);
  const short = createFakeBridge({ ops: { chain_set: () => ({ ok: true, value: { chains: [] } }) } });
  assert.equal((await chainSet(short, [{ ...chainNode(0, "K"), mute: true }])).ok, false);
  const refused = createFakeBridge({ ops: { chain_set: () => fail(5, "x") } });
  assert.deepEqual(await chainSet(refused, [{ ...chainNode(0, "K"), mute: true }]), { ok: false, code: 5, text: "x" });
});

test("select asks for showChains only when requested and maps is_showing_chains", async () => {
  const bridge = createFakeBridge({ ops: { select: (a) => ({ ok: true, value: a.showChains ? { name: "Kick", is_showing_chains: true } : { name: "Kick" } }) } });
  const plain = await select(bridge, node);
  const unfold = await select(bridge, node, { showChains: true });
  const no = await select(bridge, node, { showChains: false });
  assert.deepEqual(bridge.calls.map((c) => "showChains" in c.args), [false, true, false]);
  assert.deepEqual(plain, { ok: true, value: { name: "Kick", isShowingChains: null } });
  assert.deepEqual(unfold, { ok: true, value: { name: "Kick", isShowingChains: true } });
  assert.deepEqual(no, plain);
  const cannot = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "G", is_showing_chains: null } }) } });
  assert.deepEqual(await select(cannot, node, { showChains: true }), { ok: true, value: { name: "G", isShowingChains: null } });
  const notTaken = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "T", is_showing_chains: false } }) } });
  assert.deepEqual(await select(notTaken, node, { showChains: true }), { ok: true, value: { name: "T", isShowingChains: false } });
});

test("a 0.1.0 script's old field names are 'outdated' (exit 5), not null or no notes", async () => {
  const oldSelect = createFakeBridge({ ops: { select: () => ({ ok: true, value: { name: "Kick", chains_shown: true } }) } });
  const node = { scope: "regular" as const, route: [0, 0, 1], name: "Kick" };
  const r = await select(oldSelect, node, { showChains: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 5);
  const oldChains = createFakeBridge({
    ops: { chains: () => ({ ok: true, value: { racks: [{ kind: "drum", total: 1, offset: 0, chains: [{ name: "K", note: 36 }] }] } }) },
  });
  const c = await chains(oldChains, [{ scope: "regular", route: [0, 0] }]);
  assert.ok(c.ok);
  if (c.ok) {
    const first = c.value[0]!;
    assert.equal(first.ok, false);
    if (!first.ok) assert.equal(first.code, 5);
  }
});

test("readTags collects the pages and validates every entry", async () => {
  const pages: Array<Record<string, unknown>> = [
    { total: 3, offset: 0, tracks: [{ scope: "regular", route: [0], name: "Bass", tags: ["fx"] }], next: 1 },
    { total: 3, offset: 1, tracks: [{ scope: "return", route: [0], name: "Verb", tags: ["send", "wet"] }] },
  ];
  const bridge = createFakeBridge({ ops: { tags_all: (a) => ({ ok: true, value: pages[a.offset === undefined ? 0 : 1]! }) } });
  assert.deepEqual(await readTags(bridge), { ok: true, value: [
    { scope: "regular", route: [0], name: "Bass", tags: ["fx"] },
    { scope: "return", route: [0], name: "Verb", tags: ["send", "wet"] },
  ] });
  assert.deepEqual(bridge.calls.map((c) => c.args), [{}, { offset: 1 }]);
  assert.equal(bridge.calls.every((c) => c.changes === false && c.token === undefined), true);
});

test("readTags rejects odd replies, a paging loop, and passes failures through", async () => {
  const odd = (value: Record<string, unknown>) => createFakeBridge({ ops: { tags_all: () => ({ ok: true, value }) } });
  assert.equal((await readTags(odd({ total: 1 }))).ok, false);
  assert.equal((await readTags(odd({ tracks: [{ scope: "regular", route: [0, 1], name: "B", tags: [] }] }))).ok, false);
  assert.equal((await readTags(odd({ tracks: [{ scope: "regular", route: [0], name: "B", tags: [1] }] }))).ok, false);
  assert.equal((await readTags(odd({ tracks: [], next: 0 }))).ok, false); // no progress
  assert.deepEqual(await readTags(createFakeBridge({ running: false })), { ok: false, code: 5, text: "Remote Script not running" });
  assert.deepEqual(await readTags(createFakeBridge({})), { ok: false, code: 5, text: TEXT_OUTDATED });
});

test("writeTags is a writing request with the token and the track's name", async () => {
  const bridge = createFakeBridge({ ops: { tags_set: () => ({ ok: true, value: { name: "Bass", tags: ["fx"], marked: true } }) } });
  assert.deepEqual(await writeTags(bridge, node, ["fx"]), { ok: true, value: { name: "Bass", tags: ["fx"], marked: true } });
  assert.deepEqual(bridge.calls, [{ op: "tags_set", args: { scope: "regular", route: [2, 1], expectName: "EQ Eight", tags: ["fx"] }, changes: true, token: true }]);
  const odd = createFakeBridge({ ops: { tags_set: () => ({ ok: true, value: { name: "Bass", tags: ["fx"] } }) } });
  assert.equal((await writeTags(odd, node, ["fx"])).ok, false);
  const stale = createFakeBridge({ ops: { tags_set: () => fail(1, "the Live Set changed; run the command again") } });
  assert.deepEqual(await writeTags(stale, node, []), { ok: false, code: 1, text: "the Live Set changed; run the command again" });
});
