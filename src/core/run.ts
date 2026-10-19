import { ExitCode, fail, ok, type CommandResult } from "./types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import type { CommandRegistry } from "./commandRegistry.js";
import { helpText, type CommandNode, type Invocation, type PickState } from "./commandTree.js";
import { parse } from "./parse.js";
import { applyPick, lookupTarget, normalizeTargets, resolveTargets, tagTargetOf, type ArgValue, type PickRequest, type Target } from "./resolveArgs.js";
import { quoteIfNeeded, tokenize } from "./tokenize.js";
import type { Bridge } from "../ableton/bridgeClient.js";
import type { PickPreview, StateChange } from "./ui.js";
import { isTagWord, nodesForTag, nodesWithTag, parseTagTarget, type TagCount } from "./tags.js";

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
  /**
   * A pick answered "fill" (Tab): the platform put the object's text here and
   * resolved the pick as cancelled. Returns it once (and forgets it). Absent: no fill.
   */
  takeFill?: () => string | undefined;
  /** Longest wait for a command's `pickState.read` (default 600 ms: a bridge request times out at 500); beyond it the list opens without symbols. */
  stateCapMs?: number;
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
    /** Parallel to `candidates`: which typed text each row matched (several texts); absent = the kind. */
    details?: string[];
    /** The command's `pickState`, read for the candidates: shown as symbols (see SelectRequest.state). */
    state?: { label: string; values: Array<boolean | null>; change?: StateChange };
  }) => Promise<ObjectNode[] | null>;
  /**
   * Before a `#…` target is resolved: read the tags from the script now (awaited,
   * so "no such tag" is told apart from "script not running"). A failing result
   * (exit 5, the script's text) ends the run. Absent: the bridge check alone.
   */
  refreshTags?: () => Promise<CommandResult | null>;
  /** Ask the user to choose among the Set's tags (a bare `#` target); null = cancelled. Absent: `#` answers exit 5. */
  pickTags?: (request: { title: string; tags: TagCount[]; multi: boolean; preview: PickPreview }) => Promise<string[] | null>;
}

export interface RunOutcome {
  result: CommandResult;
  /** The invocation as it should be remembered — with every address made unambiguous. */
  line?: string;
  /** The user backed out of a pick: nothing ran and nothing should be shown. */
  cancelled?: boolean;
  /** Tab on a pick list: nothing ran; reopen the palette with this text in the prompt. */
  fill?: string;
}

/** The command and its options, before any target. */
function headWords(invocation: Invocation<string>): string[] {
  const words = [...invocation.path];
  for (const [name, value] of Object.entries(invocation.options)) {
    // `--name value`, the form the docs use; `=` only where a space would be wrong
    // (an empty value, or one starting with a dash that would read as an option).
    if (value === true) words.push(`--${name}`);
    else if (value === "" || value.startsWith("-")) words.push(`--${name}=${quoteIfNeeded(value)}`);
    else words.push(`--${name}`, quoteIfNeeded(value));
  }
  return words;
}

/** A target as it appears in a command line: resolved ones by unique path, others as typed. */
function targetWord(value: Target, nodes: ObjectNode[]): string {
  if (typeof value === "string") return quoteIfNeeded(value);
  return quoteIfNeeded(uniquePath(nodes, value));
}

/**
 * The line to remember: every path target by its unique path, each object once
 * (the handler's own resolved arguments, in order); text arguments and options
 * as typed. A re-run never asks again and keeps its meaning when the Set grows.
 */
function canonicalLine(
  invocation: Invocation<string>,
  args: ArgValue[][],
  nodes: ObjectNode[],
  node?: CommandNode<any, any>,
  targets: Target[][] = [],
  typed: Target[][] = [],
): string {
  const words: string[] = [];
  args.forEach((values, argIndex) => {
    const def = node?.args?.[argIndex];
    // `--pick`: the line is remembered as typed, so a re-run opens the list again.
    if (invocation.options.pick === true && def?.kind === "path") {
      for (const t of typed[argIndex] ?? []) words.push(targetWord(t, nodes));
      return;
    }
    // `#fx` is remembered as typed (a re-run hits the tracks tagged then), not as the paths it hit.
    const covered = new Set<string>();
    if (def?.kind === "path" && def.rest !== true) {
      for (const t of targets[argIndex] ?? []) {
        const tag = typeof t === "string" ? tagTargetOf(nodes, t, def.kinds) : null;
        if (tag && tag !== "list") {
          words.push(tag.typed);
          for (const n of nodesForTag(nodes, tag, def.kinds)) covered.add(n.handleId);
        }
      }
    }
    for (const v of values) {
      if (typeof v !== "string" && covered.has(v.handleId)) continue;
      words.push(targetWord(v, nodes));
    }
  });
  return [...headWords(invocation), ...words].join(" ");
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
  request: { argIndex: number; valueIndex: number; texts: Array<{ valueIndex: number }> },
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
    const code = outcome ? (outcome.fill !== undefined ? "filled" : outcome.cancelled ? "cancelled" : String(outcome.result.code)) : "threw";
    log(`cmdAbl: run: ${outcome?.line ?? input.trim()} -> ${code} (${now() - started} ms)`);
  }
}

/**
 * The state symbols for a pick list of `node`, or undefined: the command's
 * `pickState.read` under a time cap. Never throws; a failure, a wrong-length
 * answer or a timeout means "no symbols".
 */
async function readPickState(
  node: CommandNode<any, any>,
  candidates: ObjectNode[],
  invocation: Invocation<string>,
  capMs: number,
): Promise<{ label: string; values: Array<boolean | null>; change?: StateChange } | undefined> {
  const spec = node.pickState;
  if (!spec) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const values = await Promise.race([
      spec.read(candidates, invocation),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), capMs);
      }),
    ]);
    if (!Array.isArray(values) || values.length !== candidates.length) return undefined;
    return {
      label: spec.label,
      values: values.map((v) => (v === true || v === false ? v : null)),
      ...readChange(spec, invocation),
    };
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The preview of what confirming does, or nothing: a throwing or odd `change` is "no preview". */
function readChange(spec: PickState, invocation: Invocation<string>): { change?: StateChange } {
  try {
    const change = spec.change?.(invocation);
    return change === "toggle" || change === "on" || change === "off" ? { change } : {};
  } catch {
    return {};
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
  let nodes = needsLive ? deps.liveNodes() : [];
  let targets = normalizeTargets(node, invocation, nodes, quoted);
  const typedTargets = targets.map((values) => [...values]);

  // Tags live in the Set and are read by the Remote Script: `#…` cannot be answered without it.
  const usesTags = targets.some(
    (values, i) => node.args?.[i]?.kind === "path" && values.some((t) => typeof t === "string" && parseTagTarget(t) !== null),
  );
  if (usesTags) {
    let unavailable: CommandResult | null;
    try {
      unavailable = deps.refreshTags ? await deps.refreshTags() : await bridgeUnavailable(deps);
    } catch (e: unknown) {
      unavailable = fail(ExitCode.UNAVAILABLE, `tags unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (unavailable) return { result: unavailable };
    nodes = deps.liveNodes(); // the tree now carries the fresh tags
  } else if (deps.refreshTags) {
    // A bare word may act as a tag (`mute synth`): that must not rest on cached tags — the cache can
    // be stale (another Set opened, a tag just written) or not loaded yet (cold start). So a bare
    // word that the cache says is a tag, or that names nothing, reads the tags first. If the read
    // fails the cached tags are not trusted: bare words then work on names only, as without a script.
    const asTagWord = targets.some(
      (values, i) =>
        node.args?.[i]?.kind === "path" &&
        values.some((t) => {
          if (typeof t !== "string" || !isTagWord(t.trim())) return false;
          const kinds = node.args?.[i]?.kinds;
          return lookupTarget(nodes, t, kinds).length === 0 || nodesWithTag(nodes, t, kinds).length > 0;
        }),
    );
    if (asTagWord) {
      let failed = false;
      try {
        failed = (await deps.refreshTags()) !== null;
      } catch {
        failed = true;
      }
      // (Shallow copies: `children` still point at the originals, so resolution must not read tags through them.)
      nodes = failed ? nodes.map((n) => ({ ...n, tags: undefined })) : deps.liveNodes();
    }
  }

  // Resolve; every ambiguous address costs the user one pick.
  for (;;) {
    const step = resolveTargets(node, invocation, targets, nodes);
    if (step.kind === "error") return { result: step.result };
    if (step.kind === "tags") {
      const { request } = step;
      if (!deps.pickTags) return { result: fail(ExitCode.UNAVAILABLE, "the tag list is not available in this build") };
      const command = invocation.path.join(" ");
      const names = await deps.pickTags({
        title: `${command}: which tags?`,
        tags: request.tags,
        multi: request.multi,
        preview: previewFor(node, invocation, targets, { ...request, texts: [{ valueIndex: request.valueIndex }] }, nodes),
      });
      if (!names || names.length === 0) return { result: ok(), cancelled: true };
      // The `#` becomes the chosen `#name` targets, resolved on the next round.
      targets = targets.map((values, i) =>
        i === request.argIndex
          ? values.flatMap((v, k) => (k === request.valueIndex ? names.slice(0, request.multi ? undefined : 1).map((n) => `#${n}`) : [v]))
          : values,
      );
      continue;
    }
    if (step.kind === "pick") {
      const { request } = step;
      const quotedTexts = request.texts.map((t) => `"${t.query}"`).join(", ");
      const command = invocation.path.join(" ");
      const real = request.texts.filter((t) => !t.suggested).map((t) => `"${t.query}"`).join(", ");
      const lost = request.texts.filter((t) => t.suggested).map((t) => `"${t.query}"`).join(", ");
      const title = request.suggestion
        ? real
          ? `${command}: ${real} ${request.texts.filter((t) => !t.suggested).length > 1 ? "match" : "matches"} — nothing matches ${lost}: did you mean`
          : `${command}: nothing matches ${quotedTexts} — did you mean`
        : `${command}: ${request.texts.length > 1 ? `${quotedTexts} match` : `"${request.query}" matches`} ${request.candidates.length}`;
      const state = await readPickState(node, request.candidates, invocation, deps.stateCapMs ?? 600);
      const chosen = await deps.pick({
        title,
        ...(state ? { state } : {}),
        ...(request.details ? { details: request.details } : {}),
        candidates: request.candidates,
        multi: request.multi,
        nodes,
        preview: previewFor(node, invocation, targets, request, nodes),
      });
      const filled = deps.takeFill?.();
      if (filled !== undefined) return { result: ok(), cancelled: true, fill: filled };
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
    // A pick the handler opened itself (`api.pick`) may have been answered "fill".
    // A failing handler keeps its failure (the fill is dropped): nothing fails silently.
    const filled = deps.takeFill?.();
    if (filled !== undefined && result.code === ExitCode.OK) return { result: ok(), cancelled: true, fill: filled };
    return { result, line: canonicalLine(invocation, step.invocation.args, nodes, node, targets, typedTargets) };
  }
}
