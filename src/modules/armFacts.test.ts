import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeBridge } from "../ableton/bridgeFake.js";
import { TEXT_STALE } from "../ableton/bridgeProtocol.js";
import { loadArmFacts } from "./armFacts.js";
import { factsRefusal } from "./trackSetValue.js";

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
  const facts = await loadArmFacts(bridge, nodes);
  assert.equal(facts?.length, 2);
  assert.equal(bridge.calls.filter((c) => c.op === "track_facts").length, 1);
  assert.equal(facts?.[0]?.ok && facts[0].value.canBeArmed, true);
  assert.equal(facts?.[1]?.ok && facts[1].value.canBeArmed, false);
});

test("loadArmFacts: no script → undefined, no request", async () => {
  const bridge = createFakeBridge({ running: false });
  assert.equal(await loadArmFacts(bridge, nodes), undefined);
  assert.equal(bridge.calls.length, 0);
  // now known unavailable: no hello again either
  assert.equal(bridge.state(), "unavailable");
  assert.equal(await loadArmFacts(bridge, nodes), undefined);
  assert.equal(bridge.calls.length, 0);
});

test("loadArmFacts: an outdated script without the op → undefined", async () => {
  const bridge = createFakeBridge({ ops: {} });
  assert.equal(await loadArmFacts(bridge, nodes), undefined);
});

test("loadArmFacts: an entry that fails alone stays an entry", async () => {
  const bridge = createFakeBridge({
    ops: { track_facts: () => ({ ok: true, value: { tracks: [entry(true), { error: { code: "stale", text: "x" } }] } }) },
  });
  const facts = await loadArmFacts(bridge, nodes);
  assert.equal(facts?.[0]?.ok, true);
  assert.deepEqual(facts?.[1], { ok: false, code: 1, text: TEXT_STALE });
});

test("factsRefusal: unarmable MIDI track, group, stale entry, missing facts", () => {
  const ok = { ok: true as const, value: { name: "a", canBeArmed: true, isGroup: false, isGrouped: false, arm: false } };
  assert.equal(factsRefusal(ok), undefined);
  assert.equal(factsRefusal(undefined), undefined);
  assert.equal(factsRefusal({ ok: true, value: { ...ok.value, canBeArmed: false, arm: null } }), "Live does not allow arming this track (e.g. no input device)");
  assert.equal(
    factsRefusal({ ok: true, value: { ...ok.value, canBeArmed: false, isGroup: true, arm: null } }),
    "group tracks cannot be armed",
  );
  assert.equal(factsRefusal({ ok: true, value: { ...ok.value, isGroup: true } }), "group tracks cannot be armed");
  assert.equal(factsRefusal({ ok: false, code: 1, text: TEXT_STALE }), TEXT_STALE);
  // any other failed entry: no objection, the SDK-only path decides
  assert.equal(factsRefusal({ ok: false, code: 1, text: "Remote Script: AttributeError" }), undefined);
});
