import { test } from "node:test";
import assert from "node:assert/strict";
import { ExitCode } from "../../core/types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { fail } from "../../ableton/bridgeProtocol.js";
import { parse } from "../../core/parse.js";
import { createFakeApi } from "../testPorts.js";
import { activate, tagsLines } from "./index.js";

const bass = { name: "Bass", path: "/Bass", kind: "track", scope: "live_set", route: [3] } as unknown as ObjectNode;

function setup(ops: Parameters<typeof createFakeApi>[0] extends infer O ? O : never) {
  const fake = createFakeApi(ops);
  activate(fake.api);
  const sub = (name: string) => fake.commands[0]!.children!.find((c) => c.name === name)!;
  const run = (name: string, options: Record<string, string | true> = {}) =>
    sub(name).run!({ path: ["tagtest", name], options, args: [[bass]] } as never, undefined as never) as Promise<{ code: number; message?: string }>;
  return { fake, run };
}

test("get prints the fields as lines", async () => {
  const { run, fake } = setup({
    bridge: { ops: { track_tags: () => ({ ok: true, value: { name: "Bass", present: true, type: "str", length: 3, value: "a,b" } }) } },
  });
  const r = await run("get");
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, 'track: Bass\npresent: true\ntype: str\nlength: 3\nvalue: "a,b"');
  assert.equal(fake.bridge.calls[0]!.op, "track_tags");
  assert.deepEqual(tagsLines({ name: "X", present: false }), ["track: X", "present: false"]);
});

test("set sends only what is asked and prints what Live kept", async () => {
  const { run, fake } = setup({
    bridge: { ops: { track_tags_set: () => ({ ok: true, value: { name: "Bass", stored: true, type: "list", length: 1, same: true } }) } },
  });
  const r = await run("set", { value: "kick", as: "list", undo: true });
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, "track: Bass\nstored: true\ntype: list\nlength: 1\nsame: true");
  const call = fake.bridge.calls[0]!;
  assert.equal(call.op, "track_tags_set");
  assert.equal(call.token, true);
  assert.deepEqual({ v: call.args.value, a: call.args.as, u: call.args.undo, f: call.args.fill }, { v: "kick", a: "list", u: true, f: undefined });
});

test("set needs something to store; bridge failures keep their code", async () => {
  const { run } = setup({ bridge: { ops: { track_tags_set: () => fail(1, "stale") } } });
  assert.equal((await run("set")).code, ExitCode.USAGE);
  const r = await run("set", { clear: true });
  assert.equal(r.code, 1);
  assert.equal(r.message, "stale");
});

test("dirty prints one line and takes only known candidates", async () => {
  const fake = createFakeApi({
    bridge: {
      ops: {
        mark_modified: (a) => ({
          ok: true,
          value: { name: "Bass", candidate: a.candidate, touched: "track name", can_undo_before: false, can_undo_after: null },
        }),
      },
    },
  });
  activate(fake.api);
  const dirty = fake.commands[0]!.children!.find((c) => c.name === "dirty")!;
  const r = (await dirty.run!({ path: ["tagtest", "dirty"], options: {}, args: [["toggle_name"], [bass]] } as never, undefined as never)) as { code: number; message?: string };
  assert.equal(r.message, "toggle_name: track name; undo step: before no after ?");
  assert.equal(fake.bridge.calls[0]!.token, true);
  assert.equal(parse("tagtest dirty nope /Bass", fake.commands).kind, "error");
});
