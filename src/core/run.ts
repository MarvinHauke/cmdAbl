import { ExitCode, fail, ok, type CommandResult } from "../types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import type { CommandRegistry } from "../commandRegistry.js";
import { helpText, type Invocation } from "./commandTree.js";
import { parse } from "./parse.js";
import { applyPick, normalizeTargets, resolveTargets, type Target } from "./resolveArgs.js";
import { quoteIfNeeded, tokenize } from "./tokenize.js";

// The one path every typed line takes: parse → resolve (asking the user to
// pick when an address is ambiguous) → run → result. Everything it needs from
// the outside is injected, so the flow is testable without Live.

export interface RunDeps {
  registry: CommandRegistry;
  /** The current Live Set as a flat list of addressable objects. */
  liveNodes: () => ObjectNode[];
  /** Ask the user to choose among candidates; null = cancelled. */
  pick: (request: { title: string; candidates: ObjectNode[]; multi: boolean }) => Promise<ObjectNode[] | null>;
}

export interface RunOutcome {
  result: CommandResult;
  /** The invocation as it should be remembered — with every address made unambiguous. */
  line?: string;
  /** The user backed out of a pick: nothing ran and nothing should be shown. */
  cancelled?: boolean;
}

function canonicalLine(invocation: Invocation<string>, targets: Target[][], nodes: ObjectNode[]): string {
  const words = [...invocation.path];
  for (const [name, value] of Object.entries(invocation.options)) {
    words.push(value === true ? `--${name}` : `--${name}=${quoteIfNeeded(value)}`);
  }
  for (const values of targets) {
    for (const value of values) {
      words.push(quoteIfNeeded(typeof value === "string" ? value : uniquePath(nodes, value)));
    }
  }
  return words.join(" ");
}

export async function runLine(input: string, deps: RunDeps): Promise<RunOutcome> {
  const line = input.trim();
  const { registry } = deps;

  // Commands still registered the old way parse their own raw tokens.
  const first = tokenize(line).tokens[0]?.value ?? "";
  if (registry.isLegacy(first)) {
    return { result: await registry.run(first, line.split(/\s+/).slice(1)), line };
  }

  const parsed = parse<void>(line, registry.roots());
  if (parsed.kind === "error") return { result: parsed.result };
  if (parsed.kind === "help") {
    if (parsed.node) return { result: ok(helpText(parsed.node, parsed.path)) };
    const lines = registry.list().map((def) => `${def.name.padEnd(12)} ${def.description}`).sort();
    return { result: ok(lines.join("\n")) };
  }

  const { node, invocation } = parsed;
  const needsLive = (node.args ?? []).some((def) => def.kind === "path");
  const nodes = needsLive ? deps.liveNodes() : [];
  let targets = normalizeTargets(node, invocation, nodes);

  // Resolve; every ambiguous address costs the user one pick.
  for (;;) {
    const step = resolveTargets(node, invocation, targets, nodes);
    if (step.kind === "error") return { result: step.result };
    if (step.kind === "pick") {
      const { request } = step;
      const chosen = await deps.pick({
        title: `${invocation.path.join(" ")}: "${request.query}" matches ${request.candidates.length}`,
        candidates: request.candidates,
        multi: request.multi,
      });
      if (!chosen || chosen.length === 0) return { result: ok(), cancelled: true };
      targets = applyPick(targets, request, request.multi ? chosen : chosen.slice(0, 1));
      continue;
    }

    let result: CommandResult;
    try {
      result = (await node.run!(step.invocation, undefined)) ?? ok();
    } catch (e: unknown) {
      result = fail(ExitCode.FAILURE, `${invocation.path.join(" ")}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { result, line: canonicalLine(invocation, targets, nodes) };
  }
}
