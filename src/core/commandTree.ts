import type { CommandResult } from "../types.js";
import type { NodeKind } from "../ableton/objectTree.js";

// The declarative command tree — the single source of truth for execution,
// help and completion (docs/feature-plans/0005-command-tree-and-module-authoring.md).
//
// Model (POSIX/GNU style, like `git` or `docker`):
//   cmdabl setup                    command → subcommand
//   pakabl install <id>             command → subcommand → positional argument
//   mute -d /a /b                   command → option → variadic positional arguments
// Bare words are command/subcommand names; `-x`/`--long` are options; `--`
// ends option parsing; `--help`/`-h` exists on every node.

export type ArgKind = "path" | "enum" | "text" | "number";

export interface ArgDef {
  name: string;
  kind: ArgKind;
  /** Default true. Optional arguments must come after required ones. */
  required?: boolean;
  /** Takes all remaining tokens as separate values. Only allowed on the last argument. */
  variadic?: boolean;
  /**
   * Takes the rest of the line as ONE value (tokens joined by a space), so a
   * single-target command works without quoting: `goto /Opal Lead/Reverb`.
   * Only allowed on the last argument; not combinable with `variadic`.
   */
  rest?: boolean;
  /** `path` arguments: which kinds of objects may match. Default: all. */
  kinds?: NodeKind[];
  /**
   * How many objects ONE token may resolve to (`path` arguments). "one"
   * (default): zero matches → not found, several → ambiguous. "all": every
   * match is passed on. Different from `variadic`, which is about tokens.
   */
  multiple?: "one" | "all";
  /** Key of a completer registered by a module; supplies the candidates. */
  complete?: string;
}

export interface OptionDef {
  /** Long name without dashes, e.g. "force" for `--force`. */
  name: string;
  /** Single-character short form without the dash, e.g. "f" for `-f`. */
  short?: string;
  /** If true the option consumes a value: `--name value` or `--name=value`. */
  takesValue?: boolean;
  summary: string;
}

/** What a handler receives. `V` is the argument value type (raw strings until resolved). */
export interface Invocation<V = string> {
  /** The command words that were matched, e.g. ["pakabl", "install"]. */
  path: string[];
  /** Options by long name; `true` for flags without a value. */
  options: Record<string, string | true>;
  /** One entry per declared argument, in order; each holds 0..n values. */
  args: V[][];
}

export type CommandRun<P, V> = (
  invocation: Invocation<V>,
  ports: P,
) => CommandResult | void | Promise<CommandResult | void>;

export interface CommandNode<P = unknown, V = string> {
  /** One word: lowercase letters, digits and dashes. */
  name: string;
  /** One line; shown in the palette and in help. */
  summary: string;
  aliases?: string[];
  /** Group node: has children and is not runnable on its own. */
  children?: CommandNode<P, V>[];
  options?: OptionDef[];
  /** Leaf node: positional arguments, in order. */
  args?: ArgDef[];
  /**
   * Companions the command cannot work without. The platform checks them
   * right after parsing — before resolving or asking the user to pick — and
   * ends the run with the companion's own code and text (exit 5: not
   * installed / outdated / not running) without calling `run`. "bridge" is the
   * Remote Script. Leaf nodes only.
   */
  requires?: "bridge"[];
  /** Removes or irreversibly changes something — such commands may not fan out via `multiple: "all"`. */
  destructive?: boolean;
  /** Leaf node only. */
  run?: CommandRun<P, V>;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED_OPTIONS = new Set(["help"]);
const RESERVED_SHORTS = new Set(["h"]);

/**
 * Check the structural rules of a tree. Returns a list of human-readable
 * problems (empty = valid) so a module's mistake is reported at startup,
 * not when a user happens to type the broken command.
 */
export function validateTree(roots: CommandNode<any, any>[]): string[] {
  const problems: string[] = [];

  function checkSiblings(nodes: CommandNode<any, any>[], where: string): void {
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const word of [node.name, ...(node.aliases ?? [])]) {
        if (seen.has(word)) problems.push(`${where}: duplicate name or alias "${word}"`);
        seen.add(word);
      }
    }
  }

  function checkNode(node: CommandNode<any, any>, parents: string[]): void {
    const at = [...parents, node.name].join(" ");
    if (!NAME_RE.test(node.name)) problems.push(`${at}: invalid name "${node.name}" (use a-z, 0-9, -)`);
    for (const alias of node.aliases ?? []) {
      if (!NAME_RE.test(alias)) problems.push(`${at}: invalid alias "${alias}"`);
    }
    if (!node.summary.trim()) problems.push(`${at}: missing summary`);

    const isGroup = (node.children?.length ?? 0) > 0;
    if (isGroup && node.run) problems.push(`${at}: a node has either children or run, not both`);
    if (!isGroup && !node.run) problems.push(`${at}: a leaf needs run (or children to be a group)`);
    if (isGroup && node.args?.length) problems.push(`${at}: a group cannot declare arguments`);
    if (isGroup && node.requires?.length) problems.push(`${at}: requires belongs on the runnable node, not on a group`);
    for (const need of node.requires ?? []) {
      if (need !== "bridge") problems.push(`${at}: unknown requirement "${String(need)}"`);
    }

    const optionNames = new Set<string>();
    const optionShorts = new Set<string>();
    for (const opt of node.options ?? []) {
      if (!NAME_RE.test(opt.name)) problems.push(`${at}: invalid option name "--${opt.name}"`);
      if (RESERVED_OPTIONS.has(opt.name)) problems.push(`${at}: option "--${opt.name}" is reserved`);
      if (optionNames.has(opt.name)) problems.push(`${at}: duplicate option "--${opt.name}"`);
      optionNames.add(opt.name);
      if (opt.short !== undefined) {
        if (!/^[a-zA-Z0-9]$/.test(opt.short)) problems.push(`${at}: short option "-${opt.short}" must be one character`);
        if (RESERVED_SHORTS.has(opt.short)) problems.push(`${at}: short option "-${opt.short}" is reserved`);
        if (optionShorts.has(opt.short)) problems.push(`${at}: duplicate short option "-${opt.short}"`);
        optionShorts.add(opt.short);
      }
    }

    const args = node.args ?? [];
    let sawOptional = false;
    const argNames = new Set<string>();
    args.forEach((arg, index) => {
      if (argNames.has(arg.name)) problems.push(`${at}: duplicate argument "${arg.name}"`);
      argNames.add(arg.name);
      const required = arg.required !== false;
      if (required && sawOptional) problems.push(`${at}: required argument "${arg.name}" follows an optional one`);
      if (!required) sawOptional = true;
      if (arg.variadic && index !== args.length - 1) {
        problems.push(`${at}: only the last argument may be variadic ("${arg.name}")`);
      }
      if (arg.rest && index !== args.length - 1) {
        problems.push(`${at}: only the last argument may take the rest of the line ("${arg.name}")`);
      }
      if (arg.rest && arg.variadic) problems.push(`${at}: "${arg.name}" cannot be both rest and variadic`);
      if (arg.kinds && arg.kind !== "path") problems.push(`${at}: kinds only applies to path arguments ("${arg.name}")`);
      if (arg.multiple === "all" && arg.kind !== "path") {
        problems.push(`${at}: multiple: "all" only applies to path arguments ("${arg.name}")`);
      }
      if (node.destructive && arg.multiple === "all") {
        problems.push(`${at}: a destructive command may not use multiple: "all" ("${arg.name}")`);
      }
    });

    if (isGroup) {
      checkSiblings(node.children!, at);
      for (const child of node.children!) checkNode(child, [...parents, node.name]);
    }
  }

  checkSiblings(roots, "top level");
  for (const root of roots) checkNode(root, []);
  return problems;
}

/** `pakabl install <id> [--force]` — the one-line usage of a node. */
export function usage(node: CommandNode<any, any>, path: string[]): string {
  const parts = [...path];
  if (node.children?.length) {
    parts.push("<command>");
    return parts.join(" ");
  }
  for (const opt of node.options ?? []) {
    parts.push(opt.takesValue ? `[--${opt.name} <value>]` : `[--${opt.name}]`);
  }
  for (const arg of node.args ?? []) {
    const label = arg.variadic ? `<${arg.name}>…` : `<${arg.name}>`;
    parts.push(arg.required === false ? `[${label}]` : label);
  }
  return parts.join(" ");
}

/** Multi-line help for a node: summary, usage, then its subcommands or options. */
export function helpText(node: CommandNode<any, any>, path: string[]): string {
  const lines = [node.summary, "", `usage: ${usage(node, path)}`];
  if (node.children?.length) {
    lines.push("", "commands:");
    for (const child of node.children) lines.push(`  ${child.name.padEnd(12)} ${child.summary}`);
  }
  if (node.options?.length) {
    lines.push("", "options:");
    for (const opt of node.options) {
      const flag = `${opt.short ? `-${opt.short}, ` : ""}--${opt.name}${opt.takesValue ? " <value>" : ""}`;
      lines.push(`  ${flag.padEnd(22)} ${opt.summary}`);
    }
  }
  return lines.join("\n");
}

/** The tree without handlers — plain JSON for the palette webview. */
export type SerializedNode = Omit<CommandNode<never, never>, "run" | "children"> & {
  children?: SerializedNode[];
  runnable: boolean;
};

export function serializeTree(roots: CommandNode<any, any>[]): SerializedNode[] {
  return roots.map(({ run, children, ...rest }) => ({
    ...rest,
    runnable: Boolean(run),
    ...(children?.length ? { children: serializeTree(children) } : {}),
  }));
}
