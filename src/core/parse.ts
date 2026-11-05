import { ExitCode, fail, type CommandResult } from "./types.js";
import { checkNumber, effectiveOptions, numberRule, type CommandNode, type Invocation, usage, valueNames } from "./commandTree.js";
import { NUMBERISH, chainSegments, splitPipe, tokenize, type Token } from "./tokenize.js";

// Turns a typed line into a matched leaf plus a (not yet resolved) invocation.
// Modules never parse: this is the only place raw input is interpreted.
// Resolving `path` arguments against the Live Set is a separate, later step.

export type ParseOutcome<P = unknown> =
  | {
      kind: "run";
      node: CommandNode<P, any>;
      invocation: Invocation<string>;
      /** Parallel to `invocation.args`: whether each value was typed in quotes (a joined `rest` value: false). */
      quoted: boolean[][];
    }
  /** `--help`, or a group typed without a subcommand. `node` is null for the top level. */
  | { kind: "help"; node: CommandNode<P, any> | null; path: string[] }
  | { kind: "error"; result: CommandResult };

const error = <P>(code: Exclude<CommandResult["code"], 0>, message: string): ParseOutcome<P> => ({
  kind: "error",
  result: fail(code, message),
});

/** The child named (or aliased) `word`. Shared with the completion engine (complete.ts). */
export function findChild<P>(nodes: readonly CommandNode<P, any>[], word: string): CommandNode<P, any> | undefined {
  return nodes.find((n) => n.name === word || n.aliases?.includes(word));
}

/** The child of a group that takes the words which are no subcommand (`CommandNode.fallback`), if there is one. */
export function fallbackOf<P>(node: CommandNode<P, any>): CommandNode<P, any> | undefined {
  return node.children?.find((c) => c.fallback === true && !(c.children?.length));
}

/**
 * An option starts with an unquoted dash; quotes later in the token (`--to="a b"`) are fine. A
 * number (`-6`, `-inf`) is a value, not an option, unless it is exactly a declared short option of
 * the node (`shorts`, e.g. a command with `-1`); the command words before the node is known have none.
 */
export function startsOption(input: string, token: Token, shorts: readonly string[] = []): boolean {
  if (input[token.start] !== "-" || !token.value.startsWith("-")) return false;
  if (NUMBERISH.test(token.value) && !(token.value.length === 2 && shorts.includes(token.value.slice(1)))) return false;
  return true;
}

export function parse<P = unknown>(fullInput: string, roots: CommandNode<P, any>[]): ParseOutcome<P> {
  // Everything after a top-level `|` is one raw argument (plan 0018); the words before it are parsed as usual.
  const pipe = splitPipe(fullInput);
  const input = pipe ? pipe.head : fullInput;
  const tokenized = tokenize(input);
  if (!tokenized.ok) return error(ExitCode.USAGE, tokenized.error);
  const tokens = tokenized.tokens;
  if (tokens.length === 0) return { kind: "help", node: null, path: [] };

  // 1. Walk command words down the tree.
  let nodes = roots;
  let node: CommandNode<P, any> | undefined;
  const path: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (startsOption(input, token)) break; // options start here
    const child = findChild(nodes, token.value);
    if (!child) break;
    node = child;
    path.push(child.name);
    i++;
    if (!child.children?.length) break; // reached a leaf
    nodes = child.children;
  }

  if (!node) return error(ExitCode.NOT_FOUND, `unknown command: "${tokens[0]!.value}"`);

  // `<command> config`: the settings subcommand the platform added (CommandNode.config). A real subcommand of that name wins (the walk took it).
  if (path.length === 1 && node.config && tokens[i]?.value === "config" && !tokens[i]!.quoted && !pipe) {
    node = node.config;
    path.push("config");
    i++;
  }

  let isGroup = (node.children?.length ?? 0) > 0;
  const rest = tokens.slice(i);
  const endOfOptions = rest.findIndex((t) => startsOption(input, t) && t.value === "--");
  const optionTokens = endOfOptions < 0 ? rest : rest.slice(0, endOfOptions);
  const wantsHelp = optionTokens.some((t) => startsOption(input, t) && (t.value === "--help" || t.value === "-h"));
  if (wantsHelp) return { kind: "help", node, path };

  // A group with a fallback child (`map CC37 | …` beside `map learn | …`): words that are no subcommand belong to the fallback.
  if (isGroup && (rest.length > 0 || pipe)) {
    const fallback = fallbackOf(node);
    if (fallback) {
      node = fallback;
      isGroup = false;
    }
  }

  if (isGroup) {
    if (rest.length === 0) return { kind: "help", node, path };
    return error(
      ExitCode.USAGE,
      `unknown subcommand "${rest[0]!.value}" for "${path.join(" ")}"\n` +
        `valid: ${node.children!.map((c) => c.name).join(", ")}\nusage: ${usage(node, path)}`,
    );
  }

  if (pipe && !(node.args ?? []).some((a) => a.raw)) {
    return error(ExitCode.USAGE, `"|" is only for commands that take a command line (quote it to use it as text)\nusage: ${usage(node, path)}`);
  }

  // 2. Options and positionals of the leaf.
  const options: Record<string, string | true> = {};
  const multi: Record<string, string[]> = {};
  const positionals: string[] = [];
  const positionalQuoted: boolean[] = [];
  const defs = effectiveOptions(node);
  const shorts = defs.flatMap((d) => (d.short ? [d.short] : []));
  let optionsEnded = false;

  for (let k = 0; k < rest.length; k++) {
    const token = rest[k]!;
    const text = token.value;
    if (optionsEnded || !startsOption(input, token, shorts) || text === "-") {
      positionals.push(text);
      positionalQuoted.push(token.quoted);
      continue;
    }
    if (text === "--") {
      optionsEnded = true;
      continue;
    }

    let name: string;
    let inlineValue: string | undefined;
    if (text.startsWith("--")) {
      const eq = text.indexOf("=");
      name = eq === -1 ? text.slice(2) : text.slice(2, eq);
      inlineValue = eq === -1 ? undefined : text.slice(eq + 1);
    } else {
      name = text.slice(1);
    }
    const def = text.startsWith("--") ? defs.find((d) => d.name === name) : defs.find((d) => d.short === name);
    if (!def) {
      const hint = (node.args?.length ?? 0) > 0 ? "\n(quote it or put -- before it to use it as text)" : "";
      return error(ExitCode.USAGE, `unknown option "${text}" for "${path.join(" ")}"${hint}\nusage: ${usage(node, path)}`);
    }

    if (!def.takesValue) {
      if (inlineValue !== undefined) return error(ExitCode.USAGE, `option "--${def.name}" takes no value`);
      options[def.name] = true;
      continue;
    }
    if (def.values !== undefined) {
      const got: string[] = inlineValue === undefined ? [] : [inlineValue];
      while (got.length < def.values && rest[k + 1] !== undefined) got.push(rest[++k]!.value);
      if (got.length < def.values) {
        return error(
          ExitCode.USAGE,
          `option "--${def.name}" needs ${valueNames(def).map((n) => `<${n}>`).join(" ")}\nusage: ${usage(node, path)}`,
        );
      }
      options[def.name] = true;
      multi[def.name] = got;
      continue;
    }
    // No value (last token, or an option follows): the option's default, when it has one.
    const next = rest[k + 1];
    const useDefault = def.valueDefault !== undefined && inlineValue === undefined && (next === undefined || startsOption(input, next, shorts));
    const value = useDefault ? def.valueDefault : (inlineValue ?? rest[++k]?.value);
    if (value === undefined) return error(ExitCode.USAGE, `option "--${def.name}" needs a value`);
    if (def.number) {
      if (checkNumber(value, def.number) === null) {
        return error(
          ExitCode.USAGE,
          `invalid value "${value}" for option "--${def.name}": ${numberRule(def.number)}\nusage: ${usage(node, path)}`,
        );
      }
      options[def.name] = value.trim();
    } else if (def.choices) {
      const hit = def.choices.find((c) => c.toLowerCase() === value.toLowerCase());
      if (hit === undefined) {
        return error(
          ExitCode.USAGE,
          `invalid value "${value}" for option "--${def.name}": choose one of ${def.choices.join(", ")}\nusage: ${usage(node, path)}`,
        );
      }
      options[def.name] = hit;
    } else {
      options[def.name] = value;
    }
  }

  // 3. Assign positionals to the declared arguments, in order.
  const argDefs = node.args ?? [];
  const args: string[][] = [];
  const quoted: boolean[][] = [];
  let p = 0;
  for (const def of argDefs) {
    if (def.raw) {
      // The text after `|`: no positional word goes here.
      args.push(pipe?.raw ? [pipe.raw] : []);
      quoted.push(pipe?.raw ? [false] : []);
    } else if (def.variadic) {
      args.push(positionals.slice(p));
      quoted.push(positionalQuoted.slice(p));
      p = positionals.length;
    } else if (def.rest) {
      const joined = positionals.slice(p).join(" ");
      args.push(joined ? [joined] : []);
      // One word keeps its quoting; several joined words are not "quoted".
      quoted.push(joined ? [positionals.length - p === 1 && positionalQuoted[p] === true] : []);
      p = positionals.length;
    } else if (p < positionals.length) {
      quoted.push([positionalQuoted[p] === true]);
      args.push([positionals[p++]!]);
    } else {
      args.push([]);
      quoted.push([]);
    }
    if (def.required !== false && args[args.length - 1]!.length === 0) {
      return error(ExitCode.USAGE, `missing argument <${def.name}>\nusage: ${usage(node, path)}`);
    }
  }
  // Enum arguments: only the declared values, in the declared spelling.
  for (const [k, def] of argDefs.entries()) {
    if (def.kind !== "enum" || !def.choices) continue;
    for (const [v, value] of args[k]!.entries()) {
      const hit = def.choices.find((c) => c.toLowerCase() === value.toLowerCase());
      if (hit === undefined) {
        return error(
          ExitCode.USAGE,
          `invalid value "${value}" for <${def.name}>: choose one of ${def.choices.join(", ")}\nusage: ${usage(node, path)}`,
        );
      }
      args[k]![v] = hit;
    }
  }
  if (p < positionals.length) {
    return error(ExitCode.USAGE, `unexpected argument "${positionals[p]}"\nusage: ${usage(node, path)}`);
  }

  return { kind: "run", node, invocation: { path, options, ...(Object.keys(multi).length ? { values: multi } : {}), args }, quoted };
}

/**
 * The top-level command a typed line addresses, by what the parser makes of it (so `\mute`, an alias or a
 * quoted word give the same answer as running it), or undefined for an empty line, a chain, an unknown command
 * or a line that does not parse. Used for what belongs to a command (its settings group, plan 0019), never to run it.
 */
export function rootCommandOf<P = unknown>(line: string, roots: CommandNode<P, any>[]): string | undefined {
  if (chainSegments(line).filter((s) => line.slice(s.start, s.end).trim() !== "").length > 1) return undefined;
  const parsed = parse<P>(line, roots);
  if (parsed.kind === "run") return parsed.invocation.path[0];
  if (parsed.kind === "help") return parsed.path[0];
  // A usage error still names the command the line was about (`tag --bogus`): the first word that is a command.
  const first = tokenize(line).tokens[0]?.value;
  return first !== undefined && findChild(roots, first) ? findChild(roots, first)!.name : undefined;
}
