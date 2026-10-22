import { effectiveOptions, valueLabel, valueNames, type ArgDef, type CommandNode, type OptionDef } from "./commandTree.js";
import { findChild, startsOption } from "./parse.js";
import { quoteIfNeeded, tokenize, type Token } from "./tokenize.js";

// Argument completion (plan 0006, "0.1.4: argument completion"): what the palette offers at the
// cursor, as one pure function over a snapshot. `locate` finds the position (a command word, an
// option, an option value, a positional argument, a #tag); `complete` fills it with rows.
//
// This file is bundled into the palette page at build time (build.ts exposes it as the
// `CmdComplete` global): no host or Node APIs, no URL, no TextEncoder, no structuredClone.
// It never validates and never throws: the parser decides what is wrong when Enter runs the
// line, completion only helps typing. `parse()` is not used because it stops at the first problem.

/** Most rows offered at one position. */
export const MAX_ROWS = 100;

/** What a module's completer returns for one candidate: a plain string, or the shape below. */
export interface Candidate {
  /** Shown in the list, and inserted unless `insert` is given. */
  label: string;
  /** The raw (unquoted) value to insert when it differs from the label. Core quotes it. */
  insert?: string;
  /** Short text next to the label. */
  description?: string;
}

/**
 * What a module's completer receives. `tokens` is absent in the snapshot taken when the palette opens
 * (the completer then answers for the position in general); a later server variant may pass the words
 * typed so far. A completer must be read-only: no side effects, no bridge call per call.
 */
export interface CompleterContext {
  tokens?: string[];
}

/** A module's source of candidates for an argument or option value (`api.commands.completer`). */
export type Completer = (context: CompleterContext) => Array<Candidate | string> | Promise<Array<Candidate | string>>;

/** A Live object that can be typed as a path argument, as the snapshot carries it. */
export interface PathRow {
  /** The address that names exactly this object (`uniquePath`), unquoted: what gets inserted. */
  path: string;
  /** The object's own name (last segment, without its ordinal). */
  name: string;
  kind: "track" | "device" | "chain";
}

/** A tag of the Set and how many tracks carry it. */
export interface TagRow {
  name: string;
  count: number;
}

/** What the palette page receives at open (plain JSON) and `complete` works on. */
export interface CompletionData {
  /** The command tree without handlers (`serializeTree`). */
  tree: readonly CommandNode<any, any>[];
  /** Rows of the module completers, by completer key. */
  completions: Record<string, Candidate[]>;
  /** The Set's objects in tree order, capped (see completeSnapshot.ts). */
  paths: PathRow[];
  /** The Set's tags, sorted by name, capped. */
  tags: TagRow[];
}

export type RowKind = "command" | "option" | "value" | "path" | "tag";

/** One row of the list. */
export interface CompletionItem {
  label: string;
  /** Ready to put in the line: quoted when it needs it. */
  insert: string;
  description?: string;
  kind: RowKind;
}

export interface CompletionResult {
  items: CompletionItem[];
  /** The part of the line `insert` replaces (half-open offsets). */
  replace: { from: number; to: number };
  /** One hint for this position, e.g. `<old>` or `<track|device>`; shown when nothing is typed or nothing matches. */
  usage?: string;
}

// ── locate ──────────────────────────────────────────────────────────────────────────────────────

type Node = CommandNode<any, any>;

/** Where the cursor is, without any judgement about whether the line before it is valid. */
export type Where =
  /** A command word at the top level or below a group. */
  | { at: "command"; nodes: readonly Node[]; path: string[]; sub: boolean }
  /** A word starting with a dash on a runnable command (or a group: only `--help`). */
  | { at: "option"; node: Node; path: string[]; given: ReadonlySet<string> }
  /** The value (the `index`-th of several) of `option`; `inline` = typed as `--name=`. */
  | { at: "optionValue"; node: Node; path: string[]; option: OptionDef; index: number; inline: boolean }
  /** A positional argument. `prior` = the words of this argument before the cursor (a `rest` argument spans several). */
  | { at: "arg"; node: Node; path: string[]; arg: ArgDef; prior: Token[] }
  /** Nothing to offer: an unknown command, an extra argument, after the end. */
  | { at: "none" };

/** The token being completed and the range of the line it covers. */
export interface Located {
  where: Where;
  /** The token's range in the line (`from === to` when the cursor is in whitespace). */
  token: { from: number; to: number };
  /** What the user typed in the current word, up to the cursor, unquoted. */
  prefix: string;
  /** Where the replacement starts for the current word (after `--name=` for an inline value; the start of a `rest` argument's first word). */
  from: number;
}

/** The unquoted text of `input[from, to)`, which holds at most one word (an open quote is fine). */
function typed(input: string, from: number, to: number): string {
  const slice = input.slice(from, to);
  return tokenize(slice).tokens[0]?.value ?? "";
}

/**
 * Where the cursor is. `tokens` are `tokenize(input).tokens` (the partial last word of an open
 * quote included); the result names the position and the word under the cursor. Never validates
 * and never throws: an unknown command or an extra argument is `{ at: "none" }`.
 */
export function locate(input: string, tokens: readonly Token[], cursor: number, tree: readonly Node[]): Located {
  const at = Math.max(0, Math.min(cursor, input.length));
  // The word under the cursor: one that contains it (its end counts), else a new empty one.
  let index = tokens.findIndex((t) => t.start < at && at <= t.end);
  const hit = index >= 0 ? tokens[index]! : undefined;
  if (index < 0) index = tokens.filter((t) => t.end < at).length; // all words that end before the cursor, none after it
  const before = tokens.slice(0, index);
  const token = hit ?? { value: "", start: at, end: at, quoted: false };
  const range = { from: token.start, to: token.end };
  const none = (prefix = ""): Located => ({ where: { at: "none" }, token: range, prefix, from: token.start });

  // 1. Command words.
  let nodes: readonly Node[] = tree;
  let node: Node | undefined;
  const path: string[] = [];
  let k = 0;
  while (k < before.length) {
    const word = before[k]!;
    if (startsOption(input, word)) break;
    const child = findChild(nodes, word.value);
    if (!child) break;
    node = child;
    path.push(child.name);
    k++;
    if (!child.children?.length) break;
    nodes = child.children;
  }
  const isGroup = (node?.children?.length ?? 0) > 0;
  const prefix = hit ? typed(input, token.start, at) : "";

  if (k === before.length && (node === undefined || isGroup)) {
    // Every word before the cursor is a command word and the node below is a group (or the top level).
    if (hit && startsOption(input, hit)) {
      return node ? { where: { at: "option", node, path, given: new Set() }, token: range, prefix, from: token.start } : none(prefix);
    }
    return { where: { at: "command", nodes, path, sub: node !== undefined }, token: range, prefix, from: token.start };
  }
  if (!node || isGroup) return none(prefix); // an unknown word where a command or subcommand belongs

  // 2. Options and positionals of the leaf, as parse() reads them but without checking anything.
  const defs = effectiveOptions(node);
  const shorts = defs.flatMap((d) => (d.short ? [d.short] : []));
  const rest = before.slice(k);
  const given = new Set<string>();
  const positionals: Token[] = [];
  let ended = false;
  let pending: { def: OptionDef; got: number } | null = null;
  const needs = (def: OptionDef): number => def.values ?? 1;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (pending) {
      pending.got++;
      if (pending.got >= needs(pending.def)) pending = null;
      continue;
    }
    if (ended || !startsOption(input, word, shorts) || word.value === "-") {
      positionals.push(word);
      continue;
    }
    if (word.value === "--") {
      ended = true;
      continue;
    }
    const long = word.value.startsWith("--");
    const eq = long ? word.value.indexOf("=") : -1;
    const name = long ? word.value.slice(2, eq < 0 ? undefined : eq) : word.value.slice(1);
    const def = long ? defs.find((d) => d.name === name) : defs.find((d) => d.short === name);
    if (!def) continue;
    given.add(def.name);
    if (!def.takesValue) continue;
    const have = eq < 0 ? 0 : 1;
    if (def.values !== undefined) {
      if (have < def.values) pending = { def, got: have };
      continue;
    }
    if (have === 1) continue;
    const next = rest[i + 1] ?? hit; // the word after it: a later one, or the one under the cursor (none: the cursor is in a new word)
    if (def.valueDefault !== undefined && next !== undefined && startsOption(input, next, shorts)) continue; // used the default
    pending = { def, got: 0 };
  }

  const startsHere = hit !== undefined && !ended && startsOption(input, hit, shorts);
  // The word under the cursor is the next value of an option, unless the option has a default and an option follows.
  if (pending && !(pending.def.valueDefault !== undefined && startsHere)) {
    return { where: { at: "optionValue", node, path, option: pending.def, index: pending.got, inline: false }, token: range, prefix, from: token.start };
  }
  if (startsHere) {
    const long = hit.value.startsWith("--");
    const eq = long ? hit.value.indexOf("=") : -1;
    if (eq >= 0) {
      const def = defs.find((d) => d.name === hit.value.slice(2, eq));
      if (def?.takesValue) {
        const raw = input.slice(hit.start, hit.end);
        const rawEq = raw.indexOf("=");
        const from = hit.start + rawEq + 1;
        return { where: { at: "optionValue", node, path, option: def, index: 0, inline: true }, token: range, prefix: typed(input, from, at), from };
      }
      return none(prefix);
    }
    return { where: { at: "option", node, path, given }, token: range, prefix, from: token.start };
  }

  // 3. A positional argument.
  const defsOfArgs = node.args ?? [];
  let p = 0;
  let target: ArgDef | undefined;
  let first = 0; // index (in `positionals`) of the first word of the target argument
  for (const def of defsOfArgs) {
    if (def.variadic || def.rest) {
      target = def;
      first = p;
      break;
    }
    if (p === positionals.length) {
      target = def;
      first = p;
      break;
    }
    p++;
  }
  if (!target) return none(prefix);
  const prior = target.rest ? positionals.slice(first) : [];
  if (target.rest && prior.length > 0) {
    // One value made of several words: the prefix and the range start at the first of them.
    const start = prior[0]!.start;
    const text = [...prior.map((w) => w.value), prefix].join(" ");
    return { where: { at: "arg", node, path, arg: target, prior }, token: range, prefix: text, from: start };
  }
  return { where: { at: "arg", node, path, arg: target, prior }, token: range, prefix, from: token.start };
}

// ── matching and rows ───────────────────────────────────────────────────────────────────────────

/** 0 = the name starts with the text, 1 = a word of it does, 2 = it occurs, -1 = no match. Ignores case. */
function nameScore(name: string, text: string): number {
  if (text === "") return 0;
  const n = name.toLowerCase();
  const t = text.toLowerCase();
  if (n.startsWith(t)) return 0;
  const at = n.indexOf(t);
  if (at < 0) return -1;
  return /[\s\-_/#.]/.test(n[at - 1] ?? "") ? 1 : 2;
}

/** Path rows: every typed word occurs in the path; own name first (prefix, word start, anywhere), then a parent's name, then the rest. */
function pathScore(row: PathRow, text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const path = row.path.toLowerCase();
  if (!words.every((w) => path.includes(w))) return -1;
  const own = row.name.toLowerCase();
  const first = words[0]!;
  if (path.startsWith(first) || own.startsWith(first)) return 0;
  const at = own.indexOf(first);
  if (at > 0 && /[\s\-_.]/.test(own[at - 1]!)) return 1; // a word of the object's own name starts with it
  if (at >= 0) return 2;
  return path.includes(`/${first}`) ? 3 : 4; // a parent's name starts with it / it occurs somewhere
}

/** Keep the rows that match, best first (ties keep their order), at most `MAX_ROWS`. */
function pick<T>(rows: readonly T[], score: (row: T) => number): T[] {
  const kept: Array<{ row: T; score: number; at: number }> = [];
  rows.forEach((row, at) => {
    const s = score(row);
    if (s >= 0) kept.push({ row, score: s, at });
  });
  kept.sort((a, b) => a.score - b.score || a.at - b.at);
  return kept.slice(0, MAX_ROWS).map((k) => k.row);
}

function candidateRows(rows: readonly (Candidate | string)[] | undefined, text: string): CompletionItem[] {
  const list = (rows ?? []).map((r) => (typeof r === "string" ? { label: r } : r)).filter((r) => typeof r?.label === "string" && r.label !== "");
  return pick(list, (r) => nameScore(r.label, text)).map((r) => ({
    label: r.label,
    insert: quoteIfNeeded(r.insert ?? r.label),
    ...(r.description ? { description: r.description } : {}),
    kind: "value" as const,
  }));
}

function choiceRows(choices: readonly string[] | undefined, text: string): CompletionItem[] {
  return pick(choices ?? [], (c) => nameScore(c, text)).map((c) => ({ label: c, insert: quoteIfNeeded(c), kind: "value" as const }));
}

/** The hint for an argument: `<name>`, `<a|b>` for choices, `<name>…` when variadic, `[<name>]` when optional. */
function argHint(arg: ArgDef): string {
  const shown = arg.kind === "enum" && arg.choices?.length ? arg.choices.join("|") : arg.name;
  const label = arg.variadic ? `<${shown}>…` : `<${shown}>`;
  return arg.required === false ? `[${label}]` : label;
}

function optionRows(node: Node, given: ReadonlySet<string>, text: string): CompletionItem[] {
  const long = text.startsWith("--");
  const want = text.replace(/^-+/, "");
  const rows: Array<{ item: CompletionItem; score: number }> = [];
  const add = (name: string, short: string | undefined, summary: string, hasValue: boolean, value: string): void => {
    const hit = long ? nameScore(name, want) : want.length === 1 && short === want ? 0 : nameScore(name, want);
    if (hit < 0) return;
    rows.push({
      score: hit,
      item: {
        label: `--${name}`,
        insert: `--${name}`,
        description: `${short ? `-${short}  ` : ""}${hasValue ? `<${value}>  ` : ""}${summary}`,
        kind: "option",
      },
    });
  };
  for (const def of effectiveOptions(node)) {
    if (given.has(def.name)) continue; // already typed: not offered again
    add(def.name, def.short, def.summary, def.takesValue === true, def.values !== undefined ? valueNames(def).join("> <") : valueLabel(def));
  }
  add("help", "h", "show how to use this command", false, "");
  rows.sort((a, b) => a.score - b.score);
  return rows.slice(0, MAX_ROWS).map((r) => r.item);
}

/** Option and argument sources shared by the value positions. */
function valueRows(data: CompletionData, source: { choices?: string[]; complete?: string }, text: string): CompletionItem[] {
  const rows = [...choiceRows(source.choices, text)];
  if (source.complete) rows.push(...candidateRows(data.completions[source.complete], text));
  return rows.slice(0, MAX_ROWS);
}

function pathRows(data: CompletionData, arg: ArgDef, text: string): CompletionItem[] {
  const kinds = arg.kinds;
  const rows = data.paths.filter((p) => !kinds || kinds.includes(p.kind));
  return pick(rows, (r) => pathScore(r, text)).map((r) => ({
    label: r.path,
    insert: quoteIfNeeded(r.path),
    description: r.kind,
    kind: "path" as const,
  }));
}

function tagRows(data: CompletionData, text: string): CompletionItem[] {
  const negate = text.startsWith("!");
  const name = text.replace(/^!?#/, "");
  return pick(data.tags, (t) => nameScore(t.name, name)).map((t) => ({
    label: `${negate ? "!" : ""}#${t.name}`,
    insert: `${negate ? "!" : ""}#${t.name}`,
    description: `${t.count} track${t.count === 1 ? "" : "s"}`,
    kind: "tag" as const,
  }));
}

function commandRows(nodes: readonly Node[], text: string): CompletionItem[] {
  const rows: Array<{ item: CompletionItem; score: number; at: number }> = [];
  nodes.forEach((node, at) => {
    const hit = nameScore(node.name, text);
    if (hit >= 0) rows.push({ item: { label: node.name, insert: node.name, description: node.summary, kind: "command" }, score: hit, at });
    else if (text !== "") {
      // An alias that fits when the name does not: offered as its own row.
      for (const alias of node.aliases ?? []) {
        const s = nameScore(alias, text);
        if (s >= 0) rows.push({ item: { label: alias, insert: alias, description: `${node.name}: ${node.summary}`, kind: "command" }, score: s, at });
      }
    }
  });
  rows.sort((a, b) => a.score - b.score || a.at - b.at);
  return rows.slice(0, MAX_ROWS).map((r) => r.item);
}

// ── complete ────────────────────────────────────────────────────────────────────────────────────

/**
 * The rows for the word under `cursor` in `line`, the range they replace and a hint for the
 * position. Pure; never throws. At the top level only commands are listed: the palette adds
 * history and Live objects itself (plan 0006).
 */
export function complete(line: string, cursor: number, data: CompletionData): CompletionResult {
  try {
    return completeInner(line, cursor, data);
  } catch {
    return { items: [], replace: { from: Math.max(0, Math.min(cursor, line.length)), to: Math.max(0, Math.min(cursor, line.length)) } };
  }
}

function completeInner(line: string, cursor: number, data: CompletionData): CompletionResult {
  const tokens = tokenize(line).tokens;
  const here = locate(line, tokens, cursor, data.tree);
  const w = here.where;
  const replace = { from: here.from, to: here.token.to };
  const reply = (items: CompletionItem[], usage?: string): CompletionResult => ({ items, replace, ...(usage ? { usage } : {}) });

  switch (w.at) {
    case "none":
      return reply([]);
    case "command":
      return reply(commandRows(w.nodes, here.prefix), w.sub ? "<command>" : undefined);
    case "option":
      return reply(optionRows(w.node, w.given, here.prefix));
    case "optionValue": {
      const opt = w.option;
      const label = opt.values !== undefined ? valueNames(opt)[w.index] ?? "value" : valueLabel(opt);
      return reply(valueRows(data, opt, here.prefix), `<${label}>`);
    }
    case "arg": {
      const arg = w.arg;
      const hint = argHint(arg);
      const tag = !arg.rest && arg.kind === "path" && /^!?#/.test(here.prefix) && !/["']/.test(line[here.from] ?? "");
      if (tag) return reply(tagRows(data, here.prefix), hint);
      if (arg.kind === "path") {
        const rows = pathRows(data, arg, here.prefix);
        if (arg.complete) rows.push(...candidateRows(data.completions[arg.complete], here.prefix));
        return reply(rows.slice(0, MAX_ROWS), hint);
      }
      if (arg.kind === "number") return reply([], hint);
      return reply(valueRows(data, arg, here.prefix), hint);
    }
  }
}
