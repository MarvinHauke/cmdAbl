import { ExitCode, fail, type CommandResult, type TargetOutcome } from "../types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { resolvePath, resolveStructural } from "../ableton/resolvePath.js";
import type { NodeKind } from "../ableton/objectTree.js";
import { matches } from "./match.js";
import type { CommandNode, Invocation } from "./commandTree.js";

// "Resolve before the handler": turns the raw strings of `path` arguments into
// the Live objects they name, so no command ever has to deal with ambiguity.
// Pure — it works on a flattened object tree — and never guesses: an address
// that matches several objects becomes a pick request for the platform.

/** What a handler finds in `invocation.args`: resolved objects for path arguments, text otherwise. */
export type ArgValue = string | ObjectNode;

/**
 * Bare words that can be read two ways: as one pattern (`joined`: every word
 * occurs in a path) and as separate targets (each of `words` names objects on
 * its own). The platform never chooses between the readings silently.
 */
export interface Alternatives {
  joined: string;
  words: string[];
}

/** A target is still text until it has been resolved (or picked by the user). */
export type Target = string | ObjectNode | Alternatives;

/** One typed text the pick list answers. */
export interface PickText {
  valueIndex: number;
  query: string;
  candidates: ObjectNode[];
}

export interface PickRequest {
  argIndex: number;
  /** Position of the first ambiguous text (the chosen objects take its place). */
  valueIndex: number;
  /** The first ambiguous text. */
  query: string;
  /** Every candidate of every ambiguous text, each object once. */
  candidates: ObjectNode[];
  /** Whether several candidates may be chosen (the argument takes several targets). */
  multi: boolean;
  /** ALL ambiguous texts of the argument — one list answers them together. */
  texts: PickText[];
  /**
   * Parallel to `candidates` when the list answers several texts or two
   * readings: which typed text(s) each row matched. Absent: the row detail
   * stays the object's kind.
   */
  details?: string[];
}

export type ResolveStep =
  | { kind: "resolved"; invocation: Invocation<ArgValue> }
  | { kind: "pick"; request: PickRequest }
  | { kind: "error"; result: CommandResult };

type AnyNode = CommandNode<any, any>;

/**
 * The objects a typed target names: the strict rules of `resolvePath` first
 * (same segments, then a substring of the path); when they find nothing and
 * the text has several words, every word occurring in the path, in any order
 * (`matches`, the same rule as `find`), restricted to `kinds`. A text the
 * strict rules already found never widens.
 */
export function lookupTarget(nodes: ObjectNode[], text: string, kinds?: NodeKind[]): ObjectNode[] {
  const strict = resolvePath(nodes, text, kinds);
  if (strict.length > 0 || !/\s/.test(text.trim())) return strict;
  return nodes.filter((n) => (!kinds || kinds.includes(n.kind)) && matches(n.path, text));
}

/**
 * The objects each reading of `alt` names, in order: the joined pattern first,
 * then each word on its own (strict rules); each object once, with the typed
 * texts it matched.
 */
export function alternativeHits(
  nodes: ObjectNode[],
  alt: Alternatives,
  kinds?: NodeKind[],
): { candidates: ObjectNode[]; matched: string[][] } {
  const candidates: ObjectNode[] = [];
  const matched: string[][] = [];
  // An object the joined text hit is labelled with it alone; a word only labels
  // objects the joined text did not hit (or another word did).
  const joinedHits = new Set<string>();
  const add = (text: string, hits: ObjectNode[], isJoined: boolean) => {
    for (const hit of hits) {
      const at = candidates.findIndex((c) => c.handleId === hit.handleId);
      if (isJoined) joinedHits.add(hit.handleId);
      if (at < 0) {
        candidates.push(hit);
        matched.push([text]);
      } else if (!joinedHits.has(hit.handleId) && !matched[at]!.includes(text)) {
        matched[at]!.push(text);
      }
    }
  };
  add(alt.joined, lookupTarget(nodes, alt.joined, kinds), true);
  for (const word of alt.words) add(word, resolvePath(nodes, word, kinds), false);
  return { candidates, matched };
}

/**
 * Split what the parser collected into individual targets. For an argument
 * that takes several paths:
 *   - a comma always separates targets: `mute /Opal Lead, /Kick`;
 *   - a word starting with `/`, or a quoted word, starts its own target (the
 *     remembered lines are made of those). Bare words after a `/` word that
 *     together name an existing path stay with it: `mute /Opal Lead`;
 *   - the other bare words are tried together first: if they name a path, or
 *     every word occurs in some path (`matches`), they are ONE target
 *     (`mute vermona kick`; one hit resolves, several ask the user). With no
 *     hit each word is its own target, so `mute kick snare` names two tracks.
 *   - when the joined words hit AND every word also names objects on its own
 *     (a group "Drums" holding "Kick": `mute drums kick`), both readings are
 *     plausible and the platform does not choose: the target becomes
 *     `Alternatives`, answered by one pick list (joined hits first, then each
 *     word's). The comma (`mute drums, kick`) says "two targets" outright.
 *
 * A single-target argument (`goto` takes `rest`) arrives as one text and
 * follows the one-pattern rule in `lookupTarget`.
 *
 * `quoted` is parallel to the invocation's args (absent: nothing was quoted).
 */
export function normalizeTargets(
  node: AnyNode,
  invocation: Invocation<string>,
  nodes: ObjectNode[],
  quoted: boolean[][] = [],
): Target[][] {
  return (node.args ?? []).map((def, i) => {
    const values = invocation.args[i] ?? [];
    if (def.kind !== "path" || !def.variadic || values.length === 0) return values;
    const isQuoted = (k: number) => quoted[i]?.[k] === true;
    // Without commas a quoted word is its own target; with commas only commas separate (a quoted
    // name never splits at a comma inside it, and never forms a path by accident).
    const anyQuoted = values.some((_, k) => isQuoted(k));
    const joined = values.join(" ");
    if (!anyQuoted) {
      if (joined.includes(",")) return joined.split(",").map((part) => part.trim()).filter(Boolean);
      if (values.length > 1 && resolveStructural(nodes, joined, def.kinds).length > 0) return [joined];
    } else {
      // Commas outside quotes still separate: split the unquoted words, keep quoted ones whole.
      const hasBareComma = values.some((v, k) => !isQuoted(k) && v.includes(","));
      if (hasBareComma) {
        const parts: string[] = [];
        let current: string[] = [];
        const flush = () => {
          const text = current.join(" ").trim();
          if (text) parts.push(text);
          current = [];
        };
        values.forEach((v, k) => {
          if (isQuoted(k)) {
            current.push(v);
            return;
          }
          const pieces = v.split(",");
          pieces.forEach((piece, n) => {
            if (n > 0) flush();
            if (piece.trim()) current.push(piece.trim());
          });
        });
        flush();
        return parts;
      }
    }

    const own = (k: number) => isQuoted(k) || values[k]!.startsWith("/");
    const targets: Target[] = [];
    let k = 0;
    while (k < values.length) {
      if (isQuoted(k)) {
        targets.push(values[k++]!);
      } else if (own(k)) {
        // A `/` word may continue with bare words that complete an existing path.
        let end = k + 1;
        while (end < values.length && !own(end)) end++;
        let take = 1;
        for (let upTo = end; upTo > k + 1; upTo--) {
          if (resolveStructural(nodes, values.slice(k, upTo).join(" "), def.kinds).length > 0) {
            take = upTo - k;
            break;
          }
        }
        targets.push(values.slice(k, k + take).join(" "));
        k += take;
      } else {
        let end = k;
        while (end < values.length && !own(end)) end++;
        const run = values.slice(k, end);
        const text = run.join(" ");
        if (run.length > 1 && resolveStructural(nodes, text, def.kinds).length > 0) {
          targets.push(text);
        } else if (run.length > 1 && lookupTarget(nodes, text, def.kinds).length > 0) {
          const alt: Alternatives = { joined: text, words: run };
          const bothWays = run.every((word) => resolvePath(nodes, word, def.kinds).length > 0);
          // Two readings only matter when they name different objects.
          targets.push(bothWays && alternativeHits(nodes, alt, def.kinds).candidates.length > 1 ? alt : text);
        } else {
          targets.push(...run);
        }
        k = end;
      }
    }
    return targets;
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
      args.push(values as ArgValue[]);
      continue;
    }

    const resolved: ObjectNode[] = [];
    const ambiguous: Array<PickText & { matched?: string[][] }> = [];
    for (const [valueIndex, target] of values.entries()) {
      if (typeof target === "object" && "joined" in target) {
        const hits = alternativeHits(nodes, target, def.kinds);
        if (hits.candidates.length === 1) resolved.push(hits.candidates[0]!);
        else if (hits.candidates.length > 1) {
          ambiguous.push({ valueIndex, query: target.joined, candidates: hits.candidates, matched: hits.matched });
        } else missing.push({ path: target.joined, ok: false, code: ExitCode.NOT_FOUND, message: "nothing matches" });
        continue;
      }
      if (typeof target !== "string") {
        resolved.push(target);
        continue;
      }
      const found = lookupTarget(nodes, target, def.kinds);
      if (found.length === 0) {
        missing.push({ path: target, ok: false, code: ExitCode.NOT_FOUND, message: "nothing matches" });
      } else if (found.length === 1 || def.multiple === "all") {
        resolved.push(...found);
      } else {
        ambiguous.push({ valueIndex, query: target, candidates: found });
      }
    }
    // One list for every ambiguous text of the argument, not one after another.
    if (ambiguous.length > 0) return { kind: "pick", request: pickRequest(argIndex, def.variadic === true, ambiguous) };
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

/**
 * The one list for the ambiguous texts of an argument: the union of their
 * candidates (each object once, in text order). The row detail names the typed
 * text(s) a row matched when the list answers several texts or two readings.
 */
function pickRequest(
  argIndex: number,
  multi: boolean,
  texts: Array<PickText & { matched?: string[][] }>,
): PickRequest {
  const candidates: ObjectNode[] = [];
  const labels: string[][] = [];
  for (const entry of texts) {
    entry.candidates.forEach((candidate, k) => {
      const names = entry.matched?.[k] ?? [entry.query];
      const at = candidates.findIndex((c) => c.handleId === candidate.handleId);
      if (at < 0) {
        candidates.push(candidate);
        labels.push([...names]);
      } else {
        for (const name of names) if (!labels[at]!.includes(name)) labels[at]!.push(name);
      }
    });
  }
  const first = texts[0]!;
  const describe = texts.length > 1 || texts.some((t) => t.matched !== undefined);
  return {
    argIndex,
    valueIndex: first.valueIndex,
    query: first.query,
    candidates,
    multi,
    texts: texts.map(({ valueIndex, query, candidates: own }) => ({ valueIndex, query, candidates: own })),
    ...(describe ? { details: labels.map((names) => names.map((n) => `"${n}"`).join(", ")) } : {}),
  };
}

/** Put the user's choice in place of ALL the ambiguous texts the list answered. */
export function applyPick(targets: Target[][], request: PickRequest, chosen: ObjectNode[]): Target[][] {
  const replaced = new Set(request.texts.map((t) => t.valueIndex));
  return targets.map((values, i) => {
    if (i !== request.argIndex) return values;
    const next: Target[] = [];
    values.forEach((value, k) => {
      if (k === request.valueIndex) next.push(...chosen);
      if (!replaced.has(k)) next.push(value);
    });
    return next;
  });
}
