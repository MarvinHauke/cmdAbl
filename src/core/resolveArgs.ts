import { ExitCode, fail, type CommandResult, type TargetOutcome } from "./types.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import { resolveStructural } from "../ableton/resolvePath.js";
import type { NodeKind } from "../ableton/objectTree.js";
import { matchesNode, suggest } from "./match.js";
import type { CommandNode, Invocation } from "./commandTree.js";
import { isTagWord, nodesForTag, nodesWithTag, parseTagTarget, tagCounts, type TagCount } from "./tags.js";

// "Resolve before the handler": turns the raw strings of `path` arguments into
// the Live objects they name, so no command ever has to deal with ambiguity.
// Pure — it works on a flattened object tree — and never guesses: an address
// that matches several objects becomes a pick request for the platform.

/** What a handler finds in `invocation.args`: resolved objects for path arguments, text otherwise. */
export type ArgValue = string | ObjectNode;

/** A target is still text until it has been resolved (or picked by the user). */
export type Target = string | ObjectNode;

/** One typed text the pick list answers. */
export interface PickText {
  valueIndex: number;
  query: string;
  candidates: ObjectNode[];
  /** The text matched nothing: `candidates` are "did you mean" suggestions (only in a list that also holds real matches, or an all-suggestion list). */
  suggested?: true;
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
   * Parallel to `candidates` when the list answers several texts: which
   * typed text(s) each row matched. Absent: the row detail
   * stays the object's kind.
   */
  details?: string[];
  /**
   * Set when a text matched NOTHING and its candidates are "did you mean"
   * suggestions (fuzzy hits, never executed unasked) — in a list of their own,
   * or sharing the one list with the other texts' real matches (then the
   * suggested texts carry `suggested`). Cancelling the list ends the run with
   * `onCancel`: today's "nothing matches" failure.
   */
  suggestion?: { onCancel: CommandResult };
}

/** A bare `#`: the user picks tags; the chosen ones replace the `#` as `#name` targets. */
export interface TagPickRequest {
  argIndex: number;
  valueIndex: number;
  multi: boolean;
  tags: TagCount[];
}

export type ResolveStep =
  | { kind: "resolved"; invocation: Invocation<ArgValue> }
  | { kind: "tags"; request: TagPickRequest }
  | { kind: "pick"; request: PickRequest }
  | { kind: "error"; result: CommandResult };

type AnyNode = CommandNode<any, any>;
type AnyDef = NonNullable<AnyNode["args"]>[number];

/**
 * The objects a typed target names. Two steps, the first that finds anything
 * wins:
 *   1. the structural rules of `resolveStructural`: the text IS the object's
 *      path (same segments, then ignoring case; `#n` picks a sibling);
 *   2. text matching under the "own name" rule (`matchesNode`): every word
 *      occurs in the path and at least one occurs in the object's own name —
 *      a word that only names a parent never pulls in what sits below it.
 * Both are restricted to `kinds`. The strict `resolvePath` of src/ableton is not
 * used for text: its "anywhere in the path" substring rule is what this
 * replaces (the own-name filter lives here, where every text path goes through).
 */
export function lookupTarget(nodes: ObjectNode[], text: string, kinds?: NodeKind[]): ObjectNode[] {
  const structural = resolveStructural(nodes, text, kinds);
  if (structural.length > 0) return structural;
  if (!text.trim()) return [];
  const named = nodes.filter((n) => (!kinds || kinds.includes(n.kind)) && matchesNode(n, text));
  // A bare word that is also a tag name puts the objects tagged with it first in the same list.
  const word = text.trim();
  if (!isTagWord(word)) return named;
  const tagged = nodesWithTag(nodes, word, kinds);
  return tagged.length ? [...tagged, ...named.filter((n) => !tagged.includes(n))] : named;
}

/**
 * What a typed target means as a tag, or null: `#fx` / a bare `#`, or a bare
 * word that is exactly a tag name and names no object (a word that also
 * matches names stays an ordinary, ambiguous target: the user picks).
 * `typed` is the text as the user wrote it (history keeps it).
 */
export function tagTargetOf(nodes: ObjectNode[], text: string, kinds?: NodeKind[]): "list" | { name: string; typed: string; negate?: true } | null {
  const tag = parseTagTarget(text);
  if (tag === "list") return "list";
  if (tag) return { name: tag.name, typed: `${tag.negate ? "!" : ""}#${tag.name}`, ...(tag.negate ? { negate: true as const } : {}) };
  const word = text.trim();
  if (!isTagWord(word) || nodesWithTag(nodes, word, kinds).length === 0) return null;
  const structural = resolveStructural(nodes, text, kinds);
  if (structural.length > 0) return null;
  if (nodes.some((n) => (!kinds || kinds.includes(n.kind)) && matchesNode(n, text))) return null;
  return { name: word.toLowerCase(), typed: word };
}

/**
 * Split what the parser collected into individual targets. For an argument
 * that takes several paths:
 *   - a comma always separates targets: `mute /Bass, /Lead`;
 *   - a word starting with `/`, or a quoted word, starts its own target (the
 *     remembered lines are made of those). Bare words after a `/` word that
 *     together name an existing path stay with it: `mute /Lead Guitar`;
 *   - the other bare words are tried together first (an exact path, else
 *     text matching under the own-name rule): if they hit, that IS the
 *     reading — ONE target (`mute 808 snare`: one hit resolves, several
 *     ask once with exactly those hits; no single-word hits, no parents).
 *     Only when they hit nothing is each word its own target, so
 *     `mute kick snare` names two tracks.
 *
 * Known and accepted consequence: with a group "Drums" holding a track
 * "Kick", `mute drums kick` means the track Kick; for both write
 * `mute drums, kick` (a comma always separates).
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

    // A tag target (`#fx`, `#`) is its own target like a `/` word.
    const own = (k: number) => isQuoted(k) || values[k]!.startsWith("/") || parseTagTarget(values[k]!) !== null;
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
          targets.push(text); // the joined words hit: that is the reading
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
  // `--pick`: every match of each target goes into the list, single matches and tag hits included.
  const forced = invocation.options.pick === true;
  const args: ArgValue[][] = [];
  const missing: TargetOutcome[] = [];
  // Where each missing text sits, for the "did you mean" list (step: nothing is ambiguous any more).
  const missingAt: Array<{ argIndex: number; def: AnyDef; valueIndex: number; text: string }> = [];

  for (const [argIndex, def] of (node.args ?? []).entries()) {
    const values = targets[argIndex] ?? [];
    if (def.kind !== "path") {
      args.push(values as ArgValue[]);
      continue;
    }

    const resolved: ObjectNode[] = [];
    const ambiguous: PickText[] = [];
    // May the list mark several rows? `--pick` always (unless the argument takes one object); else per token list.
    const listMulti = forced ? def.rest !== true && !node.destructive : def.variadic === true;
    for (const [valueIndex, target] of values.entries()) {
      if (typeof target !== "string") {
        resolved.push(target);
        continue;
      }
      const tag = tagTargetOf(nodes, target, def.kinds);
      if (tag === "list") {
        const tags = tagCounts(nodes, def.kinds);
        if (tags.length === 0) return { kind: "error", result: fail(ExitCode.NOT_FOUND, `${command}: no tags in the Set`) };
        return { kind: "tags", request: { argIndex, valueIndex, multi: def.rest !== true && !node.destructive, tags } };
      }
      if (tag) {
        // `#fx`: every object with the tag, at once, for every argument that can take several
        // objects (whatever `multiple` says); a single-target argument (`rest`) still asks, and so does
        // a destructive command (one address never acts on several objects there, as for `multiple`).
        // `!#x` of a tag nothing carries would hit every track (a typo); it fails like `#x` does.
        if (tag.negate && nodesWithTag(nodes, tag.name).length === 0) {
          return { kind: "error", result: fail(ExitCode.NOT_FOUND, `${command}: no track is tagged #${tag.name}`) };
        }
        const tagged = nodesForTag(nodes, tag, def.kinds);
        if (tagged.length === 0) {
          const why = tag.negate ? `every track is tagged #${tag.name}` : `no track is tagged #${tag.name}`;
          return { kind: "error", result: fail(ExitCode.NOT_FOUND, `${command}: ${why}`) };
        }
        if (!forced && (tagged.length === 1 || (def.rest !== true && !node.destructive))) resolved.push(...tagged);
        else ambiguous.push({ valueIndex, query: target, candidates: tagged });
        continue;
      }
      const found = lookupTarget(nodes, target, def.kinds);
      if (found.length === 0) {
        missing.push({ path: target, ok: false, code: ExitCode.NOT_FOUND, message: "nothing matches" });
        missingAt.push({ argIndex, def, valueIndex, text: target });
      } else if (!forced && (found.length === 1 || def.multiple === "all")) {
        resolved.push(...found);
      } else {
        ambiguous.push({ valueIndex, query: target, candidates: found });
      }
    }
    // One list for every ambiguous text of the argument, not one after another.
    if (ambiguous.length > 0) {
      // Texts of this argument that match nothing join the same list as "did you
      // mean" rows (only what the user marks runs); one nothing fits ends the run.
      const lost = missingAt.filter((m) => m.argIndex === argIndex);
      if (lost.length === 0) return { kind: "pick", request: pickRequest(argIndex, listMulti, ambiguous) };
      const suggested = suggestionsFor(lost, nodes);
      if (suggested.some((m) => m.candidates.length === 0)) return { kind: "error", result: missingFailure(command, missing) };
      const texts: PickText[] = [
        ...ambiguous,
        ...suggested.map((m) => ({ valueIndex: m.valueIndex, query: m.text, candidates: m.candidates, suggested: true as const })),
      ].sort((a, b) => a.valueIndex - b.valueIndex);
      return {
        kind: "pick",
        request: { ...pickRequest(argIndex, listMulti, texts), suggestion: { onCancel: missingFailure(command, missing) } },
      };
    }
    // The same object named twice (e.g. picked and typed) is still one target.
    args.push(resolved.filter((n, i) => resolved.findIndex((m) => m.handleId === n.handleId) === i));
  }

  if (missing.length) {
    const failure = missingFailure(command, missing);
    // Never a silent guess: plausible fuzzy hits are offered in a list, and only
    // what the user marks runs. A text nothing fits makes the command fail
    // whatever the user marks, so that is decided first — no list, no wasted
    // question. Otherwise the first argument with missing texts is asked about.
    const suggested = suggestionsFor(missingAt, nodes);
    if (suggested.every((m) => m.candidates.length > 0)) {
      const argIndex = suggested[0]!.argIndex;
      const mine = suggested.filter((m) => m.argIndex === argIndex);
      const texts = mine.map((m) => ({ valueIndex: m.valueIndex, query: m.text, candidates: m.candidates, suggested: true as const }));
      return {
        kind: "pick",
        request: { ...pickRequest(argIndex, mine[0]!.def.variadic === true, texts), suggestion: { onCancel: failure } },
      };
    }
    return { kind: "error", result: failure };
  }
  return { kind: "resolved", invocation: { ...invocation, args } };
}

/** Today's "nothing matches" failure for the texts that were not found. */
function missingFailure(command: string, missing: TargetOutcome[]): CommandResult {
  const message =
    missing.length === 1
      ? `${command}: nothing matches "${missing[0]!.path}"`
      : `${command}: ${missing.length} targets not found`;
  return fail(ExitCode.NOT_FOUND, message, missing.length > 1 ? missing : undefined);
}

/** "Did you mean" candidates for each text that matched nothing, within the argument's kinds. */
function suggestionsFor<M extends { def: AnyDef; text: string }>(lost: M[], nodes: ObjectNode[]): Array<M & { candidates: ObjectNode[] }> {
  return lost.map((m) => {
    const pool = m.def.kinds ? nodes.filter((n) => m.def.kinds!.includes(n.kind)) : nodes;
    return { ...m, candidates: suggest(pool, m.text, ["path"], undefined, "name") };
  });
}

/**
 * The one list for the ambiguous texts of an argument: the union of their
 * candidates (each object once, in text order). The row detail names the typed
 * text(s) a row matched when the list answers several texts or two readings.
 */
function pickRequest(
  argIndex: number,
  multi: boolean,
  texts: PickText[],
): PickRequest {
  const candidates: ObjectNode[] = [];
  const labels: string[][] = [];
  // Real matches and suggestions in one list: a suggestion row is tagged `"word"?`.
  const mixed = texts.some((t) => t.suggested) && texts.some((t) => !t.suggested);
  for (const entry of texts) {
    entry.candidates.forEach((candidate) => {
      const names = [entry.suggested && mixed ? `"${entry.query}"?` : `"${entry.query}"`];
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
  const describe = texts.length > 1;
  return {
    argIndex,
    valueIndex: first.valueIndex,
    query: first.query,
    candidates,
    multi,
    texts: texts.map(({ valueIndex, query, candidates: own, suggested }) => ({ valueIndex, query, candidates: own, ...(suggested ? { suggested } : {}) })),
    ...(describe ? { details: labels.map((names) => names.join(", ")) } : {}),
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
