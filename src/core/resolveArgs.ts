import { ExitCode, fail, type CommandResult, type TargetOutcome } from "../types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { resolvePath, resolveStructural } from "../ableton/resolvePath.js";
import type { CommandNode, Invocation } from "./commandTree.js";

// "Resolve before the handler": turns the raw strings of `path` arguments into
// the Live objects they name, so no command ever has to deal with ambiguity.
// Pure — it works on a flattened object tree — and never guesses: an address
// that matches several objects becomes a pick request for the platform.

/** What a handler finds in `invocation.args`: resolved objects for path arguments, text otherwise. */
export type ArgValue = string | ObjectNode;

/** A target is still text until it has been resolved (or picked by the user). */
export type Target = string | ObjectNode;

export interface PickRequest {
  argIndex: number;
  valueIndex: number;
  /** The text that matched more than one object. */
  query: string;
  candidates: ObjectNode[];
  /** Whether several candidates may be chosen (the argument takes several targets). */
  multi: boolean;
}

export type ResolveStep =
  | { kind: "resolved"; invocation: Invocation<ArgValue> }
  | { kind: "pick"; request: PickRequest }
  | { kind: "error"; result: CommandResult };

type AnyNode = CommandNode<any, any>;

/**
 * Split what the parser collected into individual targets. For an argument
 * that takes several paths this keeps two conveniences working:
 *   - names with spaces typed without quotes: `mute /Opal Lead` is one target
 *     if the joined text names an existing path;
 *   - the older comma form: `mute /Opal Lead, /Kick`.
 */
export function normalizeTargets(node: AnyNode, invocation: Invocation<string>, nodes: ObjectNode[]): Target[][] {
  return (node.args ?? []).map((def, i) => {
    const values = invocation.args[i] ?? [];
    if (def.kind !== "path" || !def.variadic || values.length === 0) return values;
    const joined = values.join(" ");
    if (joined.includes(",")) return joined.split(",").map((part) => part.trim()).filter(Boolean);
    if (values.length > 1 && resolveStructural(nodes, joined, def.kinds).length > 0) return [joined];
    return values;
  });
}

export function resolveTargets(
  node: AnyNode,
  invocation: Invocation<string>,
  targets: Target[][],
  nodes: ObjectNode[],
): ResolveStep {
  const command = invocation.path.join(" ");
  const args: ArgValue[][] = [];
  const missing: TargetOutcome[] = [];

  for (const [argIndex, def] of (node.args ?? []).entries()) {
    const values = targets[argIndex] ?? [];
    if (def.kind !== "path") {
      args.push(values);
      continue;
    }

    const resolved: ObjectNode[] = [];
    for (const [valueIndex, target] of values.entries()) {
      if (typeof target !== "string") {
        resolved.push(target);
        continue;
      }
      const matches = resolvePath(nodes, target, def.kinds);
      if (matches.length === 0) {
        missing.push({ path: target, ok: false, code: ExitCode.NOT_FOUND, message: "nothing matches" });
      } else if (matches.length === 1 || def.multiple === "all") {
        resolved.push(...matches);
      } else {
        return {
          kind: "pick",
          request: { argIndex, valueIndex, query: target, candidates: matches, multi: def.variadic === true },
        };
      }
    }
    // The same object named twice (e.g. picked and typed) is still one target.
    args.push(resolved.filter((n, i) => resolved.findIndex((m) => m.handleId === n.handleId) === i));
  }

  if (missing.length) {
    const message =
      missing.length === 1
        ? `${command}: nothing matches "${missing[0]!.path}"`
        : `${command}: ${missing.length} targets not found`;
    return { kind: "error", result: fail(ExitCode.NOT_FOUND, message, missing.length > 1 ? missing : undefined) };
  }
  return { kind: "resolved", invocation: { ...invocation, args } };
}

/** Put the user's choice in place of the ambiguous text. */
export function applyPick(targets: Target[][], request: PickRequest, chosen: ObjectNode[]): Target[][] {
  return targets.map((values, i) => {
    if (i !== request.argIndex) return values;
    const next = [...values];
    next.splice(request.valueIndex, 1, ...chosen);
    return next;
  });
}
