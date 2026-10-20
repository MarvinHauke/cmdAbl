import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { fail as bridgeFail } from "../../ableton/bridgeProtocol.js";
import { createFakeApi } from "../testPorts.js";
import { activate } from "./index.js";

const track = (name: string, i: number, scope = "regular") =>
  ({ name, path: `/${name}`, kind: "track", scope, route: [i], handleId: name }) as unknown as ObjectNode;
const lead = track("Lead", 0);
const bass = track("Bass", 1);
const ret = track("A-Reverb", 0, "return");
const main = track("Main", 0, "master");

type Result = { code: number; message?: string; log?: string[]; details?: Array<{ ok: boolean }> } | undefined;
function setup(tags: Record<string, string[]>) {
  const fake = createFakeApi({ nodes: [lead, bass, ret, main], tags });
  activate(fake.api);
  const run = (values: string[], extra: Record<string, string | true> = {}, targets: ObjectNode[] = [], names: string[] = []) =>
    fake.commands[0]!.run!(
      { path: ["tag"], options: { rename: true, ...extra }, values: { rename: values }, args: [targets, names] } as never,
      undefined as never,
    ) as Promise<Result>;
  return { fake, run };
}
const logOf = (r: { log?: string[] }) => (r.log ?? []).join("\n");

test("--rename renames on every regular and return track, quietly, with undo lines in the log", async () => {
  const { fake, run } = setup({ Lead: ["fx", "synth"], "A-Reverb": ["fx"], Bass: ["drums"], Main: ["fx"] });
  const r = (await run(["fx", "effects"]))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, undefined);
  assert.deepEqual(fake.tagStore.get("Lead"), ["effects", "synth"]);
  assert.deepEqual(fake.tagStore.get("A-Reverb"), ["effects"]);
  assert.deepEqual(fake.tagStore.get("Main"), ["fx"]); // never the main track
  assert.match(logOf(r), /\/Lead: \+effects -fx/);
  assert.match(logOf(r), /undo: tag --set 0 \/Lead effects/);
});

test("a leading # is accepted and the new name is lowercased", async () => {
  const { fake, run } = setup({ Lead: ["fx"] });
  assert.equal((await run(["#fx", "#Effects"]))!.code, ExitCode.OK);
  assert.deepEqual(fake.tagStore.get("Lead"), ["effects"]);
});

test("a bad name (also an empty one) is exit 2 and writes nothing", async () => {
  const { fake, run } = setup({ Lead: ["fx"] });
  for (const values of [["fx", "a b"], ["", "x"], ["fx", "FX!"]]) {
    assert.equal((await run(values))!.code, ExitCode.USAGE);
  }
  assert.deepEqual(fake.tagStore.get("Lead"), ["fx"]);
});

test("an unknown old tag is exit 3; the same tag twice is exit 0 with a note", async () => {
  const { run } = setup({ Lead: ["fx"] });
  const none = (await run(["nope", "x"]))!;
  assert.equal(none.code, ExitCode.NOT_FOUND);
  assert.match(none.message ?? "", /no track is tagged #nope/);
  const same = (await run(["fx", "#FX"]))!;
  assert.equal(same.code, ExitCode.OK);
  assert.equal(same.message, "#fx is already called that");
});

test("an existing new name merges, a track with both keeps one, and the only message is the merge note", async () => {
  const { fake, run } = setup({ Lead: ["fx", "effects"], Bass: ["fx"], "A-Reverb": ["effects"] });
  const r = (await run(["fx", "effects"]))!;
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, "merged #fx into #effects");
  assert.deepEqual(fake.tagStore.get("Lead"), ["effects"]);
  assert.deepEqual(fake.tagStore.get("Bass"), ["effects"]);
});

test("combined with a target, names, --list, --set or --edit: exit 2; script off: exit 5", async () => {
  const { fake, run } = setup({ Lead: ["fx"] });
  for (const call of [run(["fx", "x"], {}, [lead]), run(["fx", "x"], {}, [], ["a"]), run(["fx", "x"], { list: true }), run(["fx", "x"], { set: "1" }), run(["fx", "x"], { edit: "a" }), run(["fx", "x"], { pick: true })]) {
    assert.equal((await call)!.code, ExitCode.USAGE);
  }
  fake.api.tags.refresh = async () => bridgeFail(5, "Remote Script not running");
  assert.equal((await run(["fx", "x"]))!.code, ExitCode.UNAVAILABLE);
});

test("a failing write shows only the failed tracks", async () => {
  const { fake, run } = setup({ Lead: ["fx"], Bass: ["fx"] });
  const write = fake.api.tags.write;
  fake.api.tags.write = (n, tags) => (n.name === "Bass" ? Promise.resolve(bridgeFail(1, "track changed")) : write(n, tags));
  const r = (await run(["fx", "x"]))!;
  assert.equal(r.code, ExitCode.FAILURE);
  assert.deepEqual(r.details?.map((d) => d.ok), [false]);
});
