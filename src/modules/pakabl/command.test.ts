import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTree } from "../../core/commandTree.js";
import { assertDocumented } from "../docs.testkit.js";
import { pakablCommand, type PakablHandlers } from "./command.js";

const calls: string[] = [];
const handlers: PakablHandlers = {
  install: async (id) => void calls.push(`install ${id}`),
  uninstall: async (id) => void calls.push(`uninstall ${id}`),
  update: async () => void calls.push("update"),
  upgrade: async (ref) => void calls.push(`upgrade ${ref}`),
  list: async () => void calls.push("list"),
};

test("pakabl is a valid group with today's subcommands", () => {
  const root = pakablCommand(handlers);
  assert.deepEqual(validateTree([root]), []);
  assert.deepEqual(root.children?.map((c) => c.name), ["install", "uninstall", "update", "upgrade", "list"]);
  const byName = Object.fromEntries((root.children ?? []).map((c) => [c.name, c]));
  const shape = (c: string) => byName[c]!.args?.map((a) => `${a.name}:${a.kind}`);
  assert.deepEqual(shape("install"), ["id:text"]);
  assert.deepEqual(shape("uninstall"), ["id:text"]);
  assert.equal(byName.uninstall!.destructive, true);
  assert.deepEqual(shape("upgrade"), ["ref:text"]);
  assert.equal(byName.update!.args, undefined);
  assert.equal(byName.list!.args, undefined);
  assert.equal(root.run, undefined); // a bare `pakabl` is the platform's usage, not ours
});

test("subcommands pass their argument to the handler", async () => {
  const root = pakablCommand(handlers);
  const run = (name: string, args: string[][]) =>
    root.children!.find((c) => c.name === name)!.run!({ path: ["pakabl", name], options: {}, args } as never, undefined as never);
  await run("install", [["a.b"]]);
  await run("uninstall", [["a.b"]]);
  await run("upgrade", [["a.b@1.0.0"]]);
  await run("update", []);
  await run("list", []);
  assert.deepEqual(calls, ["install a.b", "uninstall a.b", "upgrade a.b@1.0.0", "update", "list"]);
});

test("every pakabl command is documented and its examples parse", () => {
  assertDocumented([pakablCommand(handlers)], [
    "pakabl install",
    "pakabl uninstall",
    "pakabl update",
    "pakabl upgrade",
    "pakabl list",
  ]);
});
