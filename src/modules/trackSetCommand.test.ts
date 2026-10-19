import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePath } from "../ableton/resolvePath.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { registerTrackSetCommand, type TrackSetDocs } from "./trackSetCommand.js";
import { createFakeApi } from "./testPorts.js";
import { ExitCode, type CommandResult } from "../core/types.js";
import type { ModuleApi } from "./types.js";
import type { FakeBridgeOptions } from "../ableton/bridgeFake.js";

const docs: TrackSetDocs = { description: "d", examples: [{ line: "x" }], targetSummary: "t" };

const node = (name: string, kind: string, route: number[]): ObjectNode =>
  ({ handleId: name, route, kind, scope: "regular", name, path: `/${name}`, children: [] }) as unknown as ObjectNode;

test("arm accepts tracks only; mute/solo also chains — a device is never offered", () => {
  const { api, commands } = createFakeApi();
  registerTrackSetCommand(api, "mute", "mute", "s", docs);
  registerTrackSetCommand(api, "solo", "solo", "s", docs);
  registerTrackSetCommand(api, "arm", "arm", "s", docs);
  assert.equal(commands.length, 3);

  const tree = [node("Kick", "track", [0]), node("Kick", "device", [0, 0]), node("Kick", "chain", [0, 0, 0])];
  for (const c of commands) {
    const def = c.args?.[0];
    const armCommand = c.name === "arm";
    assert.deepEqual(def?.kinds, armCommand ? ["track"] : ["track", "chain"], c.name);
    // what the platform resolves for such an argument: never the device
    const found = resolvePath(tree, "Kick", def?.kinds);
    assert.deepEqual(found.map((n) => n.kind), armCommand ? ["track"] : ["track", "chain"], c.name);
  }
});

// ── the command end to end, with the fake ports ─────────────────────────────

type Ops = NonNullable<FakeBridgeOptions["ops"]>;

function setup(opts: {
  name: string;
  prop: "mute" | "solo" | "arm";
  value: boolean | "toggle";
  nodes: ObjectNode[];
  bridge?: FakeBridgeOptions;
  state?: Record<string, { mute?: boolean; solo?: boolean; arm?: boolean }>;
}) {
  const fake = createFakeApi({ nodes: opts.nodes, bridge: opts.bridge });
  for (const [id, state] of Object.entries(opts.state ?? {})) {
    fake.tracks.set(id, { mute: false, solo: false, arm: false, ...state });
  }
  registerTrackSetCommand(fake.api as ModuleApi, opts.prop, opts.prop, "s", docs);
  const options: Record<string, string> = opts.value === "toggle" ? {} : { set: opts.value ? "1" : "0" };
  const run = async (targets: ObjectNode[]) =>
    (await fake.commands[0]!.run!({ path: [opts.prop], options, args: [targets] } as never, undefined as never)) as
      | CommandResult
      | void;
  return { fake, run, handle: (id: string) => fake.api.tracks.track(opts.nodes.find((n) => n.handleId === id)!)! };
}

const chainsOp: Ops[string] = (args) => ({
  ok: true,
  value: {
    racks: (args.targets as unknown[]).map(() => ({ kind: "drum", total: 1, offset: 0, chains: [{ name: "Kick" }] })),
  },
});
const setOp: Ops[string] = (args) => ({
  ok: true,
  value: { chains: (args.targets as Array<{ mute?: boolean; solo?: boolean }>).map((t) => ({ name: "Kick", mute: t.mute ?? false, solo: t.solo ?? false })) },
});

const A = node("A", "track", [0]);
const B = node("B", "track", [1]);
const KICK = node("Kick", "chain", [0, 1, 0]);
const code = (r: CommandResult | void) => r?.code ?? ExitCode.OK;

test("mute on tracks and a chain: tracks through the SDK port, the chain through the bridge", async () => {
  const t = setup({
    name: "mute", prop: "mute", value: "toggle", nodes: [A, B, KICK],
    bridge: { ops: { chains: chainsOp, chain_set: setOp } }, state: { B: { mute: true } },
  });
  const result = await t.run([A, KICK, B]);
  assert.equal(code(result), ExitCode.OK);
  assert.equal(t.handle("A").mute, true);
  assert.equal(t.handle("B").mute, false);
  assert.equal(t.fake.transactions, 1); // the tracks: one undo step
  assert.deepEqual(t.fake.bridge.calls.map((c) => c.op), ["chains", "chain_set"]); // after the tracks
  assert.deepEqual(t.fake.bridge.calls[1]!.args.targets, [{ scope: "regular", route: [0, 1, 0], expectName: "Kick", mute: true }]);
});

test("only tracks: the bridge is never asked (the script is not needed)", async () => {
  const t = setup({ name: "mute", prop: "mute", value: "toggle", nodes: [A], bridge: { running: false } });
  assert.equal(code(await t.run([A])), ExitCode.OK);
  assert.equal(t.handle("A").mute, true);
  assert.equal(t.fake.bridge.calls.length, 0);
  assert.equal(t.fake.bridge.state(), "unknown");
});

test("a chain and the script unavailable: the track is done, the chain fails with the bridge's text", async () => {
  const t = setup({
    name: "mute", prop: "mute", value: "toggle", nodes: [A, KICK],
    bridge: { running: false, unavailableText: "Remote Script not running" },
  });
  const result = (await t.run([A, KICK])) as CommandResult;
  assert.equal(t.handle("A").mute, true);
  assert.equal(result.code, ExitCode.FAILURE);
  assert.equal(result.message, "mute: 1 of 2 done");
  assert.deepEqual(result.details, [
    { path: "/A", ok: true },
    { path: "/Kick", ok: false, code: ExitCode.UNAVAILABLE, message: "Remote Script not running" },
  ]);
});

test("only chains and the script unavailable: exit code 5", async () => {
  const t = setup({ name: "mute --set 0", prop: "mute", value: false, nodes: [KICK], bridge: { running: false } });
  assert.equal(code(await t.run([KICK])), ExitCode.UNAVAILABLE);
});

// ── arm: facts → write → read-back → script verify → correction ─────────────

const wire = (arm: boolean | null, canBeArmed = true) => ({
  can_be_armed: canBeArmed, is_foldable: false, is_grouped: false, arm,
});
/** track_facts answering `answers[i]` for the i-th request (the last one repeats). */
const factsOp = (answers: Array<ReturnType<typeof wire>>): Ops[string] => {
  let n = 0;
  return (args) => {
    const answer = answers[Math.min(n++, answers.length - 1)]!;
    return { ok: true, value: { tracks: (args.targets as unknown[]).map(() => answer) } };
  };
};
const armSetup = (answers: Array<ReturnType<typeof wire>>, state = { A: { arm: false } }, bridge?: FakeBridgeOptions) =>
  setup({ name: "arm", prop: "arm", value: "toggle", nodes: [A], bridge: bridge ?? { ops: { track_facts: factsOp(answers) } }, state });

test("arm: facts, then the write, then the script's verify — in that order", async () => {
  const t = armSetup([wire(false), wire(true)]);
  assert.equal(code(await t.run([A])), ExitCode.OK);
  assert.equal(t.handle("A").arm, true);
  assert.deepEqual(t.fake.bridge.calls.map((c) => c.op), ["track_facts", "track_facts"]);
  const kinds = t.fake.logs.map((l) => l.split(": ")[1]);
  assert.deepEqual(kinds.filter((k) => k === "arm facts" || k === "arm" || k === "arm verify"), ["arm facts", "arm", "arm verify"]);
});

test("arm: the script's value is the toggle base, not the SDK's stale one", async () => {
  // SDK says armed (stale); Live says not armed → toggling arms
  const t = armSetup([wire(false), wire(true)], { A: { arm: true } });
  assert.equal(code(await t.run([A])), ExitCode.OK);
  assert.equal(t.handle("A").arm, true);
});

test("arm: a track Live did not arm is a failure and the SDK is set back", async () => {
  const t = armSetup([wire(false), wire(false), wire(false)]);
  const result = (await t.run([A])) as CommandResult;
  assert.equal(result.code, ExitCode.FAILURE);
  assert.equal(result.message, "arm: 0 of 1 done");
  assert.match(result.details![0]!.message ?? "", /^Live did not arm it: its arm button is disabled/);
  assert.equal(t.handle("A").arm, false); // corrected to what Live reads
  assert.equal(t.fake.transactions, 2); // the write and the correction
});

test("arm: a track Live reports as not armable is refused before any write", async () => {
  const t = armSetup([wire(null, false)]);
  const result = (await t.run([A])) as CommandResult;
  assert.equal(result.code, ExitCode.FAILURE);
  assert.match(result.details![0]!.message ?? "", /does not allow arming it/);
  assert.equal(t.handle("A").arm, false);
  assert.equal(t.fake.bridge.calls.length, 1); // facts only; no verify
});

test("arm without the script: the SDK path as before, the log says why there are no facts", async () => {
  const t = armSetup([], { A: { arm: false } }, { running: false });
  assert.equal(code(await t.run([A])), ExitCode.OK);
  assert.equal(t.handle("A").arm, true);
  assert.ok(t.fake.logs.some((l) => l.startsWith("cmdAbl: arm facts: none (")));
});

test("arm --set 0: sets off and is verified like arm", async () => {
  const t = setup({
    name: "arm --set 0", prop: "arm", value: false, nodes: [A], state: { A: { arm: true } },
    bridge: { ops: { track_facts: factsOp([wire(true), wire(false)]) } },
  });
  assert.equal(code(await t.run([A])), ExitCode.OK);
  assert.equal(t.handle("A").arm, false);
});

// ── --set 1 / --set 0 ───────────────────────────────────────────────────────

test("mute --set 1: every target ends up muted, whatever it was; --set 0: none is", async () => {
  const on = setup({ name: "mute", prop: "mute", value: true, nodes: [A, B], state: { B: { mute: true } } });
  assert.equal(code(await on.run([A, B])), ExitCode.OK);
  assert.deepEqual([on.handle("A").mute, on.handle("B").mute], [true, true]); // B was already muted: still a success
  const off = setup({ name: "mute", prop: "mute", value: false, nodes: [A, B], state: { A: { mute: true } } });
  assert.equal(code(await off.run([A, B])), ExitCode.OK);
  assert.deepEqual([off.handle("A").mute, off.handle("B").mute], [false, false]);
});

test("toggle is unchanged without the option", async () => {
  const t = setup({ name: "solo", prop: "solo", value: "toggle", nodes: [A, B], state: { B: { solo: true } } });
  assert.equal(code(await t.run([A, B])), ExitCode.OK);
  assert.deepEqual([t.handle("A").solo, t.handle("B").solo], [true, false]);
});

test("mute --set 1 on a chain writes without reading first", async () => {
  const t = setup({
    name: "mute", prop: "mute", value: true, nodes: [KICK],
    bridge: { ops: { chains: chainsOp, chain_set: setOp } },
  });
  assert.equal(code(await t.run([KICK])), ExitCode.OK);
  assert.deepEqual(t.fake.bridge.calls.map((c) => c.op), ["chain_set"]);
  assert.deepEqual(t.fake.bridge.calls[0]!.args.targets, [{ scope: "regular", route: [0, 1, 0], expectName: "Kick", mute: true }]);
});

test("arm --set 1 follows the facts and verify logic of a toggle that arms", async () => {
  const t = setup({
    name: "arm", prop: "arm", value: true, nodes: [A], state: { A: { arm: false } },
    bridge: { ops: { track_facts: factsOp([wire(false), wire(true)]) } },
  });
  assert.equal(code(await t.run([A])), ExitCode.OK);
  assert.equal(t.handle("A").arm, true);
  assert.deepEqual(t.fake.bridge.calls.map((c) => c.op), ["track_facts", "track_facts"]);
});

test("arm --set 1 on an already armed track is a success", async () => {
  const t = setup({
    name: "arm", prop: "arm", value: true, nodes: [A], state: { A: { arm: true } },
    bridge: { ops: { track_facts: factsOp([wire(true), wire(true)]) } },
  });
  assert.equal(code(await t.run([A])), ExitCode.OK);
  assert.equal(t.handle("A").arm, true);
});

// ── the option as the platform parses it ────────────────────────────────────
import { parse } from "../core/parse.js";

test("--set accepts 0 and 1 in every spelling and rejects anything else with exit 2", () => {
  const { api, commands } = createFakeApi();
  registerTrackSetCommand(api, "mute", "mute", "s", docs);
  for (const line of ["mute --set 1 /Kick", "mute --set=1 /Kick", "mute -s 1 /Kick", "mute --set=0 \"/Kick\""]) {
    const outcome = parse(line, commands);
    assert.equal(outcome.kind, "run", line);
    if (outcome.kind === "run") assert.match(String(outcome.invocation.options.set), /^[01]$/, line);
  }
  const bad = parse("mute --set 2 /Kick", commands);
  assert.equal(bad.kind, "error");
  if (bad.kind === "error") {
    assert.equal(bad.result.code, ExitCode.USAGE);
    assert.match(bad.result.message ?? "", /choose one of 0, 1/);
  }
  // the remembered canonical form parses back to the same invocation
  const first = parse("mute --set 0 /Kick", commands);
  const remembered = parse('mute --set=0 "/Kick"', commands);
  assert.equal(first.kind === "run" && remembered.kind === "run", true);
  if (first.kind === "run" && remembered.kind === "run") {
    assert.deepEqual(remembered.invocation.options, first.invocation.options);
    assert.deepEqual(remembered.invocation.args, first.invocation.args);
  }
  const bare = parse("mute /Kick", commands);
  assert.equal(bare.kind === "run" && bare.invocation.options.set, undefined);
});

test("mute, solo and arm declare pickState with their label; goto, find and lom declare none", async () => {
  const { api, commands } = createFakeApi();
  registerTrackSetCommand(api, "mute", "mute", "s", docs);
  registerTrackSetCommand(api, "solo", "solo", "s", docs);
  registerTrackSetCommand(api, "arm", "arm", "s", docs);
  assert.deepEqual(commands.map((c) => c.pickState?.label), ["muted", "soloed", "armed"]);
  // the declared reader is the state reader: tracks come from the SDK port
  const fake = createFakeApi({ nodes: [node("A", "track", [0])], bridge: { running: false } });
  fake.tracks.set("A", { mute: true, solo: false, arm: false });
  registerTrackSetCommand(fake.api, "mute", "mute", "s", docs);
  const states = await fake.commands[0]!.pickState!.read([node("A", "track", [0])], { path: ["mute"], options: {}, args: [] });
  assert.deepEqual(states, [true]);
});

test("pickState.change previews toggle without --set, on for 1, off for 0, toggle for odd values", () => {
  const { api, commands } = createFakeApi();
  registerTrackSetCommand(api, "mute", "mute", "s", docs);
  const change = commands[0]!.pickState!.change!;
  const inv = (set?: string) => ({ path: ["mute"], options: (set === undefined ? {} : { set }) as Record<string, string | true>, args: [] });
  assert.equal(change(inv()), "toggle");
  assert.equal(change(inv("1")), "on");
  assert.equal(change(inv("0")), "off");
  assert.equal(change(inv("x")), "toggle");
});
