import { ExitCode, fail, ok, type CommandResult } from "../types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import type { CommandRegistry } from "../commandRegistry.js";
import { helpText, type CommandNode, type Invocation } from "./commandTree.js";
import { parse } from "./parse.js";
import { alternativeHits, applyPick, lookupTarget, normalizeTargets, resolveTargets, type ArgValue, type PickRequest, type Target } from "./resolveArgs.js";
import { quoteIfNeeded, tokenize } from "./tokenize.js";
import type { Bridge } from "../ableton/bridgeClient.js";
import type { PickPreview } from "./ui.js";

// The one path every typed line takes: parse → resolve (asking the user to
// pick when an address is ambiguous) → run → result. Everything it needs from
// the outside is injected, so the flow is testable without Live.

export interface RunDeps {
  registry: CommandRegistry;
  /**
   * The Remote Script bridge, for commands that declare `requires: ["bridge"]`.
   * Only `available()` is used (it never throws). Absent: such commands answer exit 5.
   */
  bridge?: () => Pick<Bridge, "available">;
  /** Log sink and clock; default console.log and Date.now. */
  log?: (line: string) => void;
  now?: () => number;
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
    /** Parallel to `candidates`: which typed text each row matched; absent = the kind. */
    details?: string[];
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
  if (typeof value === "string") return quoteIfNeeded(value);
  if ("joined" in value) return value.words.map(quoteIfNeeded).join(" ");
  return quoteIfNeeded(uniquePath(nodes, value));
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
      // The texts this list answers are replaced by what the user marks.
      if (argIndex === request.argIndex && request.texts.some((t) => t.valueIndex === valueIndex)) return;
      // Path text that resolves without a pick (one match, or `multiple: "all"`) shows as its objects.
      let expanded: Target[] = [value];
      if (typeof value === "string" && def?.kind === "path") {
        const matches = lookupTarget(nodes, value, def.kinds);
        if (matches.length === 1 || (matches.length > 1 && def.multiple === "all")) expanded = matches;
      } else if (typeof value === "object" && "joined" in value) {
        const hits = alternativeHits(nodes, value, def?.kinds).candidates;
        if (hits.length === 1) expanded = hits;
      }
      const isBefore = argIndex < request.argIndex || (argIndex === request.argIndex && valueIndex < request.valueIndex);
      for (const target of expanded) {
        if (typeof target !== "string" && !("joined" in target)) {
          if (seen.has(target.handleId)) continue;
          seen.add(target.handleId);
        }
        (isBefore ? before : after).push(targetWord(target, nodes));
      }
    });
  });
  return { before: before.join(" "), after: after.join(" ") };
}

/**
 * Run one typed line and log it: the canonical command line, the exit code and
 * how long it took (a pick the user answers is included). Evidence for "what
 * ran right before the dialog hung".
 */
export async function runLine(input: string, deps: RunDeps): Promise<RunOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? (() => Date.now());
  const started = now();
  // Logged at the start too: a handler that never returns must leave a trace.
  log(`cmdAbl: run start: ${input.trim()}`);
  let outcome: RunOutcome | undefined;
  try {
    outcome = await runLineInner(input, deps);
    return outcome;
  } finally {
    const code = outcome ? (outcome.cancelled ? "cancelled" : String(outcome.result.code)) : "threw";
    log(`cmdAbl: run: ${outcome?.line ?? input.trim()} -> ${code} (${now() - started} ms)`);
  }
}

/** A failing result when the Remote Script bridge cannot be used, else null. */
async function bridgeUnavailable(deps: RunDeps): Promise<CommandResult | null> {
  if (!deps.bridge) return fail(ExitCode.UNAVAILABLE, "the Remote Script bridge is not available in this build");
  try {
    const ready = await deps.bridge().available();
    return ready.ok ? null : fail(ready.code, ready.text);
  } catch (e: unknown) {
    // The bridge promises never to throw; nothing may throw at a user action.
    return fail(ExitCode.UNAVAILABLE, `bridge check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function runLineInner(input: string, deps: RunDeps): Promise<RunOutcome> {
  const line = input.trim();
  const { registry } = deps;

  const parsed = parse<void>(line, registry.roots());
  if (parsed.kind === "error") return { result: parsed.result };
  if (parsed.kind === "help") {
    if (parsed.node) return { result: ok(helpText(parsed.node, parsed.path)) };
    const lines = registry.list().map((def) => `${def.name.padEnd(12)} ${def.description}`).sort();
    return { result: ok(lines.join("\n")) };
  }

  const { node, invocation, quoted } = parsed;

  // Companions first: no point asking the user to pick for a command that cannot run.
  // A visible choice: with the script missing, a typo in the address answers
  // "not running" (5) rather than "not found" (3) — "cannot run at all" comes first.
  if (node.requires?.includes("bridge")) {
    const unavailable = await bridgeUnavailable(deps);
    if (unavailable) return { result: unavailable };
  }

  const needsLive = (node.args ?? []).some((def) => def.kind === "path");
  const nodes = needsLive ? deps.liveNodes() : [];
  let targets = normalizeTargets(node, invocation, nodes, quoted);

  // Resolve; every ambiguous address costs the user one pick.
  for (;;) {
    const step = resolveTargets(node, invocation, targets, nodes);
    if (step.kind === "error") return { result: step.result };
    if (step.kind === "pick") {
      const { request } = step;
      const quotedTexts = request.texts.map((t) => `"${t.query}"`).join(", ");
      const command = invocation.path.join(" ");
      const title = request.suggestion
        ? `${command}: nothing matches ${quotedTexts} — did you mean`
        : `${command}: ${request.texts.length > 1 ? `${quotedTexts} match` : `"${request.query}" matches`} ${request.candidates.length}`;
      const chosen = await deps.pick({
        title,
        ...(request.details ? { details: request.details } : {}),
        candidates: request.candidates,
        multi: request.multi,
        nodes,
        preview: previewFor(node, invocation, targets, request, nodes),
      });
      if (!chosen || chosen.length === 0) {
        // Esc on a suggestion list: nothing was found, as before (exit 3, nothing remembered).
        if (request.suggestion) return { result: request.suggestion.onCancel };
        return { result: ok(), cancelled: true };
      }
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
