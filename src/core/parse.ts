import { ExitCode, fail, type CommandResult } from "./types.js";
import { checkNumber, numberRule, type CommandNode, type Invocation, usage } from "./commandTree.js";
import { tokenize, type Token } from "./tokenize.js";

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

function findChild<P>(nodes: CommandNode<P, any>[], word: string): CommandNode<P, any> | undefined {
  return nodes.find((n) => n.name === word || n.aliases?.includes(word));
}

/** An option starts with an unquoted dash; quotes later in the token (`--to="a b"`) are fine. */
function startsOption(input: string, token: Token): boolean {
  return input[token.start] === "-" && token.value.startsWith("-");
}

export function parse<P = unknown>(input: string, roots: CommandNode<P, any>[]): ParseOutcome<P> {
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

  const isGroup = (node.children?.length ?? 0) > 0;
  const rest = tokens.slice(i);
  const endOfOptions = rest.findIndex((t) => startsOption(input, t) && t.value === "--");
  const optionTokens = endOfOptions < 0 ? rest : rest.slice(0, endOfOptions);
  const wantsHelp = optionTokens.some((t) => startsOption(input, t) && (t.value === "--help" || t.value === "-h"));
  if (wantsHelp) return { kind: "help", node, path };

  if (isGroup) {
    if (rest.length === 0) return { kind: "help", node, path };
    return error(
      ExitCode.USAGE,
      `unknown subcommand "${rest[0]!.value}" for "${path.join(" ")}"\n` +
        `valid: ${node.children!.map((c) => c.name).join(", ")}\nusage: ${usage(node, path)}`,
    );
  }

  // 2. Options and positionals of the leaf.
  const options: Record<string, string | true> = {};
  const positionals: string[] = [];
  const positionalQuoted: boolean[] = [];
  const defs = node.options ?? [];
  let optionsEnded = false;

  for (let k = 0; k < rest.length; k++) {
    const token = rest[k]!;
    const text = token.value;
    if (optionsEnded || !startsOption(input, token) || text === "-") {
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
    const value = inlineValue ?? rest[++k]?.value;
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
    if (def.variadic) {
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

  return { kind: "run", node, invocation: { path, options, args }, quoted };
}
