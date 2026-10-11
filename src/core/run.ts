import { ExitCode, fail, ok, type CommandResult } from "../types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { resolvePath, uniquePath } from "../ableton/resolvePath.js";
import type { CommandRegistry } from "../commandRegistry.js";
import { helpText, type CommandNode, type Invocation } from "./commandTree.js";
import { parse } from "./parse.js";
import { applyPick, normalizeTargets, resolveTargets, type ArgValue, type PickRequest, type Target } from "./resolveArgs.js";
import { quoteIfNeeded, tokenize } from "./tokenize.js";
import type { PickPreview } from "./ui.js";

// The one path every typed line takes: parse → resolve (asking the user to
// pick when an address is ambiguous) → run → result. Everything it needs from
// the outside is injected, so the flow is testable without Live.

export interface RunDeps {
  registry: CommandRegistry;
  /** The current Live Set as a flat list of addressable objects. */
  liveNodes: () => ObjectNode[];
  /** Ask the user to choose among candidates; null = cancelled. */
  pick: (request: {
    title: string;
    candidates: ObjectNode[];
    multi: boolean;
    /** The whole Live Set, so the pick list can label rows with unique paths. */
    nodes: ObjectNode[];
    /** The command text around the ambiguous address (see SelectRequest.preview). */
    preview: PickPreview;
  }) => Promise<ObjectNode[] | null>;
}

export interface RunOutcome {
  result: CommandResult;
  /** The invocation as it should be remembered — with every address made unambiguous. */
  line?: string;
  /** The user backed out of a pick: nothing ran and nothing should be shown. */
  cancelled?: boolean;
}

/** The command and its options, before any target. */
function headWords(invocation: Invocation<string>): string[] {
  const words = [...invocation.path];
  for (const [name, value] of Object.entries(invocation.options)) {
    words.push(value === true ? `--${name}` : `--${name}=${quoteIfNeeded(value)}`);
  }
  return words;
}

/** A target as it appears in a command line: resolved ones by unique path, others as typed. */
function targetWord(value: Target, nodes: ObjectNode[]): string {
  return quoteIfNeeded(typeof value === "string" ? value : uniquePath(nodes, value));
}

/**
 * The line to remember: every path target by its unique path, each object once
 * (the handler's own resolved arguments, in order); text arguments and options
 * as typed. A re-run never asks again and keeps its meaning when the Set grows.
 */
function canonicalLine(invocation: Invocation<string>, args: ArgValue[][], nodes: ObjectNode[]): string {
  return [...headWords(invocation), ...args.flat().map((v) => targetWord(v, nodes))].join(" ");
}

/**
 * The line split around the ambiguous target the user is about to pick for,
 * under the same rule as `canonicalLine`: path text that resolves uniquely is
 * shown as its unique path and an object appears once. Text that is still
 * ambiguous stays as typed, so `before` + chosen values + `after` equals the
 * remembered line once everything is resolved (a chosen row that duplicates a
 * listed target is dropped from the remembered line, not from the preview).
 */
function previewFor(
  node: CommandNode<any, any>,
  invocation: Invocation<string>,
  targets: Target[][],
  request: PickRequest,
  nodes: ObjectNode[],
): PickPreview {
  const before = headWords(invocation);
  const after: string[] = [];
  targets.forEach((values, argIndex) => {
    const def = node.args?.[argIndex];
    const seen = new Set<string>(); // per argument, like resolveTargets
    values.forEach((value, valueIndex) => {
      if (argIndex === request.argIndex && valueIndex === request.valueIndex) return;
      // Path text that resolves without a pick (one match, or `multiple: "all"`) shows as its objects.
      let expanded: Target[] = [value];
      if (typeof value === "string" && def?.kind === "path") {
        const matches = resolvePath(nodes, value, def.kinds);
        if (matches.length === 1 || (matches.length > 1 && def.multiple === "all")) expanded = matches;
      }
      const isBefore = argIndex < request.argIndex || (argIndex === request.argIndex && valueIndex < request.valueIndex);
      for (const target of expanded) {
        if (typeof target !== "string") {
          if (seen.has(target.handleId)) continue;
          seen.add(target.handleId);
        }
        (isBefore ? before : after).push(targetWord(target, nodes));
      }
    });
  });
  return { before: before.join(" "), after: after.join(" ") };
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
        nodes,
        preview: previewFor(node, invocation, targets, request, nodes),
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
    return { result, line: canonicalLine(invocation, step.invocation.args, nodes) };
  }
}
