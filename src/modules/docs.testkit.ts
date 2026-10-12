import assert from "node:assert/strict";
import { CommandRegistry, type Command } from "../core/commandRegistry.js";
import { parse } from "../core/parse.js";
import type { ModuleApi } from "./types.js";

// Shared by the docs test of every module (a module's test imports only its
// own folder). The texts of `--help` and the generated command reference come
// from the declarations: every runnable command carries a description, an
// example and a summary for each argument, and each example line has to parse
// for real.

/** The commands a module declares when activated against a fake API. */
export function declaredBy(activate: (api: ModuleApi) => void): Command[] {
  const registry = new CommandRegistry();
  const api = {
    commands: { add: (c: Command) => registry.add(c) },
    registerProvider: () => {},
    onPick: () => {},
    onCommandRun: () => {},
  } as unknown as ModuleApi;
  activate(api);
  return registry.roots();
}

function runnables(nodes: Command[], prefix: string[] = []): Array<{ path: string[]; node: Command }> {
  return nodes.flatMap((n) =>
    n.children ? runnables(n.children, [...prefix, n.name]) : [{ path: [...prefix, n.name], node: n }],
  );
}

/** Assert the documentation rules for `roots`; `expected` lists the runnable command names. */
export function assertDocumented(roots: Command[], expected: string[]): void {
  const all = runnables(roots);
  assert.deepEqual(all.map((r) => r.path.join(" ")).sort(), [...expected].sort());
  for (const { path, node } of all) {
    const name = path.join(" ");
    assert.ok(node.description && node.description.trim().length > 20, `${name}: description`);
    assert.ok(!node.description.includes("`"), `${name}: no markdown backticks in the description`);
    assert.ok((node.examples?.length ?? 0) >= 1, `${name}: at least one example`);
    for (const arg of node.args ?? []) assert.ok(arg.summary?.trim(), `${name}: summary for <${arg.name}>`);
    for (const opt of node.options ?? []) assert.ok(opt.summary.trim(), `${name}: summary for --${opt.name}`);
    for (const example of node.examples ?? []) {
      assert.ok(!(example.note ?? "").includes("`"), `${example.line}: no backticks in the note`);
      const outcome = parse(example.line, roots);
      assert.equal(
        outcome.kind,
        "run",
        `${example.line}: ${outcome.kind === "error" ? outcome.result.message : outcome.kind}`,
      );
      if (outcome.kind === "run") assert.deepEqual(outcome.invocation.path, path, example.line);
    }
  }
}
