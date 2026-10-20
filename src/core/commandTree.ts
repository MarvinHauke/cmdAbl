import type { CommandResult } from "./types.js";
import type { StateChange } from "./ui.js";
import type { NodeKind, ObjectNode } from "../ableton/objectTree.js";

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
   * single-target command works without quoting: `goto /2-808 Core Kit/808 Core Kit/Snare Drum`.
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
  // Note: a `#tag` target (plan 0008) fans out to every tagged object for EVERY path argument
  // except `rest` ones and those of `destructive` commands, whatever `multiple` says.
  /**
   * `enum` arguments: the allowed values, fixed at declaration time (a
   * dynamic set is an `enum` with a `complete` source and no `choices`: the
   * parser then accepts any text and the handler checks it). The parser rejects
   * anything else with a usage error that lists them; matching ignores case and
   * the handler receives the declared spelling.
   */
  choices?: string[];
  /** Key of a completer registered by a module; supplies the candidates. */
  complete?: string;
  /** One line for help and the generated reference: what the argument is. */
  summary?: string;
}

/** A worked example for help and the generated reference. */
export interface CommandExample {
  /** The line as typed, e.g. `mute /bass, /lead`. */
  line: string;
  /** What it does, in a few words. */
  note?: string;
}

export interface OptionDef {
  /** Long name without dashes, e.g. "force" for `--force`. */
  name: string;
  /** Single-character short form without the dash, e.g. "f" for `-f`. */
  short?: string;
  /** If true the option consumes a value: `--name value` or `--name=value`. */
  takesValue?: boolean;
  /**
   * Allowed values of a value option (needs `takesValue`): the parser rejects
   * anything else with a usage error listing them, ignores case and hands the
   * handler the declared spelling. Same rules as enum argument choices.
   */
  choices?: string[];
  /**
   * A numeric value option (needs `takesValue`; not with `choices`): the parser
   * rejects text that is not a number, a fraction when `integer` is set and
   * values outside `min`/`max`, with a usage error that says what is
   * accepted. The handler gets the typed text (a string, like every option).
   */
  number?: { min?: number; max?: number; integer?: boolean };
  summary: string;
}

/**
 * How a command tells the platform to read a state for its pick-list rows. The
 * platform calls `read` only when a pick list is about to open for the command
 * (never on the direct path), with a time cap: a throw, a rejection, a
 * wrong-length answer or a timeout means "no symbols" — never an error.
 */
export interface PickState {
  /** Names the state in the list: "muted", "soloed", "armed". */
  label: string;
  /**
   * `nodes` are the candidates in list order; the invocation is the parsed,
   * not yet resolved one (options such as `--set` are visible). Per candidate:
   * true = on, false = off, null = unknown.
   */
  read(nodes: ObjectNode[], invocation: Invocation<string>): Promise<Array<boolean | null>>;
  /**
   * What confirming the pick does to a row's state, for the list to preview:
   * "toggle" flips each row, "on"/"off" sets it. Same invocation as `read`.
   * Optional; a throw or another value means no preview. Only read when `read`
   * succeeded (without states the page shows no buttons to preview on).
   */
  change?(invocation: Invocation<string>): StateChange;
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
  /**
   * A sentence or two beyond `summary`: shown by `<command> --help` and in the
   * generated reference (docs/reference/commands.md): help and the docs read it
   * from here — one source.
   */
  description?: string;
  /** Worked examples (runnable nodes). Every runnable command should have one. */
  examples?: CommandExample[];
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
  /**
   * Reads the current state of the candidates of a pick list this command is
   * about to open (muted / soloed / armed), so the list can show it. Leaf only;
   * see `PickState`.
   */
  pickState?: PickState;
  /** Leaf node only. */
  run?: CommandRun<P, V>;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED_OPTIONS = new Set(["help", "pick"]);
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
    if (node.description !== undefined && (typeof node.description !== "string" || !node.description.trim())) {
      problems.push(`${at}: description must be a non-empty string`);
    }
    if (node.examples !== undefined) {
      if (!Array.isArray(node.examples)) problems.push(`${at}: examples must be a list`);
      else {
        for (const example of node.examples) {
          if (typeof example?.line !== "string" || !example.line.trim()) problems.push(`${at}: an example needs a line`);
          else if (example.note !== undefined && (typeof example.note !== "string" || !example.note.trim())) {
            problems.push(`${at}: the note of example "${example.line}" must be a non-empty string`);
          }
        }
      }
      if (node.children?.length) problems.push(`${at}: examples belong on a runnable command, not on a group`);
    }

    const isGroup = (node.children?.length ?? 0) > 0;
    if (isGroup && node.run) problems.push(`${at}: a node has either children or run, not both`);
    if (!isGroup && !node.run) problems.push(`${at}: a leaf needs run (or children to be a group)`);
    if (isGroup && node.args?.length) problems.push(`${at}: a group cannot declare arguments`);
    if (node.pickState !== undefined) {
      if (isGroup) problems.push(`${at}: pickState belongs on the runnable node, not on a group`);
      if (typeof node.pickState.label !== "string" || !node.pickState.label.trim()) problems.push(`${at}: pickState needs a label`);
      if (typeof node.pickState.read !== "function") problems.push(`${at}: pickState needs a read function`);
    }
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
      if (opt.number !== undefined) {
        if (!opt.takesValue) problems.push(`${at}: option "--${opt.name}" is numeric but takes no value`);
        if (opt.choices !== undefined) problems.push(`${at}: option "--${opt.name}" has both choices and number`);
        const { min, max } = opt.number;
        if (min !== undefined && max !== undefined && min > max) problems.push(`${at}: option "--${opt.name}" has min above max`);
      }
      if (opt.choices !== undefined) {
        if (!opt.takesValue) problems.push(`${at}: option "--${opt.name}" has choices but takes no value`);
        const lower = opt.choices.map((c) => c.toLowerCase());
        if (!lower.length) problems.push(`${at}: option "--${opt.name}" has an empty choices list`);
        if (new Set(lower).size !== lower.length) problems.push(`${at}: duplicate choices in option "--${opt.name}" (case is ignored)`);
        if (opt.choices.some((c) => c === "" || c.startsWith("-") || /\s/.test(c))) {
          problems.push(`${at}: a choice of option "--${opt.name}" is empty, starts with a dash or holds a space`);
        }
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
      if (arg.summary !== undefined && (typeof arg.summary !== "string" || !arg.summary.trim())) {
        problems.push(`${at}: the summary of argument "${arg.name}" must be a non-empty string`);
      }
      if (arg.kind === "enum" && !(arg.choices?.length) && !arg.complete) {
        problems.push(`${at}: enum argument "${arg.name}" needs choices (or a complete source for a dynamic set)`);
      }
      if (arg.kind === "enum") {
        const lower = (arg.choices ?? []).map((c) => c.toLowerCase());
        if (new Set(lower).size !== lower.length) problems.push(`${at}: duplicate choices in "${arg.name}" (case is ignored)`);
        if ((arg.choices ?? []).some((c) => c === "" || c.startsWith("-") || /\s/.test(c))) {
          problems.push(`${at}: a choice of "${arg.name}" is empty, starts with a dash or holds a space`);
        }
        if (arg.rest) problems.push(`${at}: enum argument "${arg.name}" cannot take the rest of the line`);
      }
      if (arg.choices && arg.kind !== "enum") problems.push(`${at}: choices only applies to enum arguments ("${arg.name}")`);
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

/** `value`, or `0|1` for an option with declared choices. */
export function valueLabel(opt: OptionDef): string {
  if (opt.choices?.length) return opt.choices.join("|");
  return opt.number ? "n" : "value";
}

/** "a whole number from 1 to 12" — what a numeric option accepts. */
export function numberRule(spec: NonNullable<OptionDef["number"]>): string {
  const kind = spec.integer ? "a whole number" : "a number";
  if (spec.min !== undefined && spec.max !== undefined) return `${kind} from ${spec.min} to ${spec.max}`;
  if (spec.min !== undefined) return `${kind} of at least ${spec.min}`;
  if (spec.max !== undefined) return `${kind} of at most ${spec.max}`;
  return kind;
}

/** The value as a finite number when it follows the rule, else null. */
export function checkNumber(text: string, spec: NonNullable<OptionDef["number"]>): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text.trim())) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (spec.integer && !Number.isInteger(value)) return null;
  if (spec.min !== undefined && value < spec.min) return null;
  if (spec.max !== undefined && value > spec.max) return null;
  return value;
}

/**
 * The platform's own option on every command with path arguments: lists every
 * match of each target (single matches and tagged tracks included) and lets
 * the user mark the ones to use. Added here, never declared by a module.
 */
export const PICK_OPTION: OptionDef = {
  name: "pick",
  takesValue: false,
  summary: "show every match of each target in a list (also single matches, and tracks tagged with a word); only the marked rows run",
};

/** A node's declared options plus the platform's (`--pick` on runnable nodes with path arguments). */
export function effectiveOptions(node: CommandNode<any, any>): OptionDef[] {
  const own = node.options ?? [];
  const takesPaths = !(node.children?.length) && (node.args ?? []).some((a) => a.kind === "path");
  return takesPaths ? [...own, PICK_OPTION] : own;
}

/** `pakabl install <id> [--force]` — the one-line usage of a node. */
export function usage(node: CommandNode<any, any>, path: string[]): string {
  const parts = [...path];
  if (node.children?.length) {
    parts.push("<command>");
    return parts.join(" ");
  }
  for (const opt of effectiveOptions(node)) {
    parts.push(opt.takesValue ? `[--${opt.name} <${valueLabel(opt)}>]` : `[--${opt.name}]`);
  }
  for (const arg of node.args ?? []) {
    const shown = arg.kind === "enum" && arg.choices?.length ? arg.choices.join("|") : arg.name;
    const label = arg.variadic ? `<${shown}>…` : `<${shown}>`;
    parts.push(arg.required === false ? `[${label}]` : label);
  }
  return parts.join(" ");
}

/** The lines of the `commands:`, `arguments:` and `options:` sections (shared by the short and the full help). */
function sections(node: CommandNode<any, any>): string[] {
  const lines: string[] = [];
  if (node.children?.length) {
    lines.push("", "commands:");
    for (const child of node.children) lines.push(`  ${child.name.padEnd(12)} ${child.summary}`);
  }
  const described = (node.args ?? []).filter((arg) => arg.summary);
  if (described.length) {
    lines.push("", "arguments:");
    for (const arg of described) lines.push(`  ${`<${arg.name}>`.padEnd(12)} ${arg.summary}`);
  }
  if (effectiveOptions(node).length) {
    lines.push("", "options:");
    for (const opt of effectiveOptions(node)) {
      const flag = `${opt.short ? `-${opt.short}, ` : ""}--${opt.name}${opt.takesValue ? ` <${valueLabel(opt)}>` : ""}`;
      lines.push(`  ${flag.padEnd(22)} ${opt.summary}${opt.number ? ` (${numberRule(opt.number)})` : ""}`);
    }
  }
  return lines;
}

/**
 * The full help of a node, for `man` and the reference: summary, description, usage, then its
 * subcommands, arguments, options and examples.
 */
export function helpText(node: CommandNode<any, any>, path: string[]): string {
  const lines = [node.summary];
  if (node.description) lines.push("", node.description);
  lines.push("", `usage: ${usage(node, path)}`, ...sections(node));
  if (node.examples?.length) {
    lines.push("", "examples:");
    for (const example of node.examples) {
      lines.push(`  ${example.line}`);
      if (example.note) lines.push(`      ${example.note}`);
    }
  }
  return lines.join("\n");
}

/**
 * What `<command> --help` shows: how to use it, no prose — usage, subcommands, arguments and
 * options one line each, then `more: <more>` when the caller names where the full page is.
 * (Core does not know which module offers it: `run.ts` passes `man <path>` only when a `man` command exists.)
 */
export function shortHelpText(node: CommandNode<any, any>, path: string[], more?: string): string {
  return [`usage: ${usage(node, path)}`, ...sections(node), ...(more ? ["", `more: ${more}`] : [])].join("\n");
}

/** The tree without handlers — plain JSON for the palette webview. */
export type SerializedNode = Omit<CommandNode<never, never>, "run" | "children" | "pickState"> & {
  children?: SerializedNode[];
  runnable: boolean;
};

/**
 * Exactly what `<command> --help` prints for `node`: the short help, with the `more: man <path>`
 * line only when the tree has a command named `man`.
 */
export function shortHelpIn(roots: readonly CommandNode<any, any>[], node: CommandNode<any, any>, path: string[]): string {
  return shortHelpText(node, path, roots.some((n) => n.name === "man") ? `man ${path.join(" ")}` : undefined);
}

function nodeAt(roots: readonly CommandNode<any, any>[], path: string[]): CommandNode<any, any> | undefined {
  let level: readonly CommandNode<any, any>[] = roots;
  let node: CommandNode<any, any> | undefined;
  for (const word of path) {
    node = level.find((n) => n.name === word);
    if (!node) return undefined;
    level = node.children ?? [];
  }
  return node;
}

/** What `<command> --help` prints for the node at `path`, or undefined when there is none. */
export function usageForPath(roots: readonly CommandNode<any, any>[], path: string[]): string | undefined {
  const node = nodeAt(roots, path);
  return node ? shortHelpIn(roots, node, path) : undefined;
}

/** The full help text of the node at `path` (command, then subcommands), or undefined when there is none. */
export function helpForPath(roots: readonly CommandNode<any, any>[], path: string[]): string | undefined {
  const node = nodeAt(roots, path);
  return node ? helpText(node, path) : undefined;
}

export function serializeTree(roots: CommandNode<any, any>[]): SerializedNode[] {
  return roots.map(({ run, children, pickState: _pickState, ...rest }) => ({
    ...rest,
    runnable: Boolean(run),
    ...(children?.length ? { children: serializeTree(children) } : {}),
  }));
}
