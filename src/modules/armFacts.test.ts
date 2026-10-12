import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrackFacts } from "../ableton/bridgeOps.js";
import { createFakeBridge } from "../ableton/bridgeFake.js";
import { TEXT_STALE } from "../ableton/bridgeProtocol.js";
import {
  armBase,
  armFactsLines,
  armNotChangedText,
  armReadBackLine,
  armVerifyLine,
  classifyArm,
  loadArmFacts,
  verifyArmWrites,
} from "./armFacts.js";
import { factsRefusal } from "./trackSetValue.js";


// TrackFacts as the bridge delivers it. (`isGroup` is the deprecated alias of
// `isFoldable` that the type still carries for a while; the helper keeps the
// literals in one place.)
function facts(over: { canBeArmed?: boolean; isFoldable?: boolean; arm?: boolean | null } = {}): TrackFacts {
  const f = { name: "a", canBeArmed: true, isFoldable: false, isGrouped: false, arm: false as boolean | null, ...over };
  return { ...f, isGroup: f.isFoldable } as TrackFacts;
}

const nodes = [
  { scope: "regular" as const, route: [0], name: "Drums" },
  { scope: "regular" as const, route: [1], name: "Keys" },
];
// The script's wire format (snake_case).
const entry = (canBeArmed: boolean, isGroup = false) => ({
  can_be_armed: canBeArmed,
  is_foldable: isGroup,
  is_grouped: false,
  arm: canBeArmed ? false : null,
});

test("loadArmFacts: one request for all tracks, entries in order", async () => {
  const bridge = createFakeBridge({
    ops: {
      track_facts: (args) => {
        assert.equal((args.targets as unknown[]).length, 2);
        return { ok: true, value: { tracks: [entry(true), entry(false)] } };
      },
    },
  });
  const { facts } = await loadArmFacts(bridge, nodes);
  assert.equal(facts?.length, 2);
  assert.equal(bridge.calls.filter((c) => c.op === "track_facts").length, 1);
  assert.equal(facts?.[0]?.ok && facts[0].value.canBeArmed, true);
  assert.equal(facts?.[1]?.ok && facts[1].value.canBeArmed, false);
});

test("loadArmFacts: no script → undefined, no request", async () => {
  const bridge = createFakeBridge({ running: false });
  assert.equal((await loadArmFacts(bridge, nodes)).facts, undefined);
  assert.equal(bridge.calls.length, 0);
  // now known unavailable: no hello again either
  assert.equal(bridge.state(), "unavailable");
  const again = await loadArmFacts(bridge, nodes);
  assert.equal(again.facts, undefined);
  assert.match(again.reason, /unavailable/);
  assert.equal(bridge.calls.length, 0);
});

test("loadArmFacts: an outdated script without the op → undefined", async () => {
  const bridge = createFakeBridge({ ops: {} });
  assert.equal((await loadArmFacts(bridge, nodes)).facts, undefined);
});

test("loadArmFacts: an entry that fails alone stays an entry", async () => {
  const bridge = createFakeBridge({
    ops: { track_facts: () => ({ ok: true, value: { tracks: [entry(true), { error: { code: "stale", text: "x" } }] } }) },
  });
  const { facts } = await loadArmFacts(bridge, nodes);
  assert.equal(facts?.[0]?.ok, true);
  assert.deepEqual(facts?.[1], { ok: false, code: 1, text: TEXT_STALE });
});

test("factsRefusal: unarmable MIDI track, group, stale entry, missing facts", () => {
  const ok = { ok: true as const, value: facts() };
  assert.equal(factsRefusal(ok), undefined);
  assert.equal(factsRefusal(undefined), undefined);
  assert.equal(factsRefusal({ ok: true, value: facts({ canBeArmed: false, arm: null }) }), "Live does not allow arming it: its arm button is disabled (e.g. the input device is not available)");
  assert.equal(
    factsRefusal({ ok: true, value: facts({ canBeArmed: false, isFoldable: true, arm: null }) }),
    "group tracks cannot be armed",
  );
  assert.equal(factsRefusal({ ok: true, value: facts({ isFoldable: true }) }), "group tracks cannot be armed");
  assert.equal(factsRefusal({ ok: false, code: 1, text: TEXT_STALE }), TEXT_STALE);
  // any other failed entry: no objection, the SDK-only path decides
  assert.equal(factsRefusal({ ok: false, code: 1, text: "Remote Script: AttributeError" }), undefined);
});

test("log lines: facts per track, none with a reason, read-back", async () => {
  const paths = [{ path: "/Drums" }, { path: "/Keys" }];
  const bridge = createFakeBridge({
    ops: { track_facts: () => ({ ok: true, value: { tracks: [entry(true), entry(false)] } }) },
  });
  assert.deepEqual(armFactsLines(paths, await loadArmFacts(bridge, nodes)), [
    "cmdAbl: arm facts: /Drums canBeArmed=true isFoldable=false isGrouped=false arm=false",
    "cmdAbl: arm facts: /Keys canBeArmed=false isFoldable=false isGrouped=false arm=null",
  ]);
  const off = await loadArmFacts(createFakeBridge({ running: false }), nodes);
  assert.deepEqual(armFactsLines(paths, off), [`cmdAbl: arm facts: none (${off.reason})`]);
  assert.match(off.reason, /bridge unavailable/);
  assert.equal(armReadBackLine("/Drums", true, true), "cmdAbl: arm: /Drums wrote true, reads true");
});

// ── verify ──────────────────────────────────────────────────────────────────
const writes = [
  { node: { ...nodes[0]!, path: "/Drums" }, wanted: true },
  { node: { ...nodes[1]!, path: "/Keys" }, wanted: true },
];
const wire = (arm: boolean | null) => ({ can_be_armed: true, is_foldable: false, is_grouped: false, arm });
const noSleep = { sleep: async () => {}, delayMs: 0 };

test("armBase: the script's arm wins over the SDK's; null and failures fall back", () => {
  const entry = (arm: boolean | null) => ({
    ok: true as const,
    value: facts({ arm }),
  });
  assert.equal(armBase(true, entry(false)), false); // SDK stale "true", script says off
  assert.equal(armBase(false, entry(true)), true);
  assert.equal(armBase(true, entry(null)), true);
  assert.equal(armBase(true, { ok: false, code: 1, text: "x" }), true);
  assert.equal(armBase(true, undefined), true);
});

test("classifyArm: ok, mismatch, null counts as off, failure is unknown", () => {
  const entry = (arm: boolean | null) => ({
    ok: true as const,
    value: facts({ arm }),
  });
  assert.deepEqual(classifyArm(true, entry(true)), { state: "ok", actual: true });
  assert.deepEqual(classifyArm(true, entry(false)), { state: "mismatch", actual: false });
  assert.deepEqual(classifyArm(false, entry(null)), { state: "ok", actual: false });
  assert.deepEqual(classifyArm(true, { ok: false, code: 1, text: "x" }), { state: "unknown" });
});

test("verifyArmWrites: both read back as written → ok, one request", async () => {
  const bridge = createFakeBridge({ ops: { track_facts: () => ({ ok: true, value: { tracks: [wire(true), wire(true)] } }) } });
  const verdicts = await verifyArmWrites(bridge, writes, noSleep);
  assert.deepEqual(verdicts.map((v) => v.state), ["ok", "ok"]);
  assert.equal(bridge.calls.length, 1);
});

test("verifyArmWrites: a track that stays off is a mismatch (second look included)", async () => {
  const bridge = createFakeBridge({ ops: { track_facts: (args) => ({
    ok: true,
    value: { tracks: (args.targets as Array<{ expectName: string }>).map((t) => (t.expectName === "Keys" ? wire(false) : wire(true))) },
  }) } });
  const verdicts = await verifyArmWrites(bridge, writes, noSleep);
  assert.deepEqual(verdicts.map((v) => v.state), ["ok", "mismatch"]);
  assert.equal(verdicts[1]!.actual, false);
  assert.equal(bridge.calls.length, 2); // first look, then only the mismatching track again
  assert.equal((bridge.calls[1]!.args.targets as unknown[]).length, 1);
});

test("verifyArmWrites: a slow tick — mismatch first, ok on the second look", async () => {
  let n = 0;
  const bridge = createFakeBridge({ ops: { track_facts: () => ({ ok: true, value: { tracks: [wire(++n === 1 ? false : true)] } }) } });
  const verdicts = await verifyArmWrites(bridge, [writes[0]!], noSleep);
  assert.deepEqual(verdicts, [{ state: "ok", actual: true, secondLook: true }]);
});

test("verifyArmWrites: a failing request is no objection", async () => {
  const off = createFakeBridge({ running: false });
  assert.deepEqual((await verifyArmWrites(off, writes, noSleep)).map((v) => v.state), ["unknown", "unknown"]);
  const stale = createFakeBridge({
    ops: { track_facts: () => ({ ok: true, value: { tracks: [{ error: { code: "stale", text: "x" } }, wire(true)] } }) },
  });
  assert.deepEqual((await verifyArmWrites(stale, writes, noSleep)).map((v) => v.state), ["unknown", "ok"]);
});

test("verify texts and log line", () => {
  assert.match(
    armVerifyLine("/a", true, { state: "ok", actual: true, secondLook: true }),
    /-> ok \(first look mismatched, second look decided\)$/,
  );
  assert.match(armNotChangedText(true), /^Live did not arm it: its arm button is disabled/);
  assert.equal(armNotChangedText(false), "Live did not disarm it");
  assert.equal(
    armVerifyLine("/Sub 37 Midi", true, { state: "mismatch", actual: false }),
    "cmdAbl: arm verify: /Sub 37 Midi wanted true, script reads false -> mismatch",
  );
});

test("factsRefusal: switching off is never refused for a greyed-out track", () => {
  const off = { ok: true as const, value: facts({ canBeArmed: false, arm: null }) };
  assert.equal(factsRefusal(off, false), undefined);
  assert.match(factsRefusal(off, true) ?? "", /does not allow arming/);
});
