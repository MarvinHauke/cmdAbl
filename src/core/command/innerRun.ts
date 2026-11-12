import { AsyncLocalStorage } from "node:async_hooks";
import { ExitCode, fail, type CommandResult } from "../types.js";
import type { CommandNode } from "./commandTree.js";
import { parse } from "./parse.js";
import { pipeAt, splitChain } from "./tokenize.js";
import { expandDefaults } from "./defaultCommands.js";

// Inner runs (plan 0028): one engine for a module's `api.commands.run(line)` and for a live page's page runs
// (0018 "Page runs"). A line runs through the normal command path only if every `;` part parses to a command whose
// path (after aliases) is in the effective allowlist: the calling command's `runs`, narrowed by the call's (or the
// page's) own list, and is not marked `outside`. Depth 1. Never throws; a refusal is exit 2 and a warn line.

/** The command that is running now, as the platform sees it (set around every handler call, carried by async context). */
export interface CallCtx {
  /** The command path ("tag", "stamp loop"). */
  path: string;
  /** The command and its options as they ran, for the log: `tag -l`. */
  line: string;
  /** The command's declared `runs` (checked at activation). */
  runs?: readonly string[];
  /** True inside an inner run: such a line cannot run further lines. */
  inner: boolean;
  /** False once the handler has returned: a later call is refused. */
  live: { on: boolean };
}

export const callStore = new AsyncLocalStorage<CallCtx>();

type Roots = CommandNode<any, any>[];

/**
 * The runnable node a command path addresses (a group with a fallback child addresses that child) and the path by canonical
 * names (an alias becomes its name), or undefined when the words lead to no runnable command.
 */
export function resolvePath(roots: Roots, path: readonly string[]): { node: CommandNode<any, any>; names: string[] } | undefined {
  let level: Roots | undefined = roots;
  let node: CommandNode<any, any> | undefined;
  const names: string[] = [];
  for (const word of path) {
    node = level?.find((n) => n.name === word || n.aliases?.includes(word));
    if (!node) return undefined;
    names.push(node.name);
    level = node.children;
  }
  if (node && !node.run) node = node.children?.find((c) => c.fallback && c.run);
  return node ? { node, names } : undefined;
}

/** The runnable node a parsed command path addresses. */
export function nodeAtPath(roots: Roots, path: readonly string[]): CommandNode<any, any> | undefined {
  return resolvePath(roots, path)?.node;
}

/** The command path a part addresses ("loop here"), or undefined when it does not parse to a runnable command. */
function pathOf(part: string, roots: Roots): string[] | undefined {
  const parsed = parse(part, roots);
  return parsed.kind === "run" ? [...parsed.invocation.path] : undefined;
}

/** Why `line` may not run for `allow`, or null when every part is allowed. `outside` commands are refused whatever `allow` says. */
export function refusal(line: string, allow: readonly string[], roots: Roots): string | null {
  if (pipeAt(line) >= 0) return "a bare | is not allowed here";
  const parts = splitChain(line);
  if (parts.length === 0) return "empty line";
  for (const part of parts) {
    const path = pathOf(part.text, roots);
    if (path === undefined) return `not a runnable command: ${part.text}`;
    const text = path.join(" ");
    if (nodeAtPath(roots, path)?.outside === true) return `"${text}" acts outside the Set and cannot be run this way`;
    if (!allow.includes(text)) return `"${text}" is not allowed from here`;
  }
  return null;
}

/**
 * Activation check of every declared `runs` (plan 0028): entries must be plain command paths of a runnable command and not
 * `outside`; others are dropped with a warning. Entries are rewritten to the canonical path (an alias becomes the name).
 * Mutates the nodes; never throws. Checked once, after activation: a command added later is not checked here, which is safe
 * (`outside` is checked again at every call and an entry with an option never matches a parsed path).
 */
export function sanitizeRuns(roots: Roots, warn: (text: string) => void): void {
  const visit = (node: CommandNode<any, any>, trail: string[]) => {
    const here = [...trail, node.name];
    if (node.runs !== undefined) {
      const kept: string[] = [];
      for (const entry of Array.isArray(node.runs) ? node.runs : []) {
        const label = `command "${here.join(" ")}": runs entry ${JSON.stringify(entry)}`;
        if (typeof entry !== "string" || entry.trim() === "") warn(`${label} is not a command path; dropped`);
        else if (/(^|\s)-/.test(entry)) warn(`${label} has an option; only command paths are allowed; dropped`);
        else {
          const found = resolvePath(roots, entry.trim().split(/\s+/));
          if (found === undefined) warn(`${label} is no runnable command; dropped`);
          else if (found.node.outside === true) warn(`${label} acts outside the Set and cannot be listed; dropped`);
          else if (!kept.includes(found.names.join(" "))) kept.push(found.names.join(" "));
        }
      }
      node.runs = kept;
    }
    for (const child of node.children ?? []) visit(child, here);
  };
  for (const node of roots) visit(node, []);
}

export interface InnerDeps {
  roots: () => Roots;
  /** Runs one allowed line the normal way (headless where asked), WITHOUT expanding default commands (done before the check); resolves with its result. */
  exec: (line: string, headless: boolean) => Promise<CommandResult>;
  /** The default commands (`command → line`): a bare word is expanded BEFORE the allowlist check, so a default cannot smuggle in a part that was not allowed. A throw means none. */
  defaults?: () => Promise<Readonly<Record<string, string>>>;
  log: (line: string) => void;
  warn: (text: string) => void;
}

export interface InnerCall {
  /** The calling command (from `callStore`); undefined: nothing is running. */
  ctx: CallCtx | undefined;
  /** A narrower list given with the call, or a page's `run` list. */
  narrow?: readonly string[];
  /** Set for a page run: the page's name; such a run is always headless (the page's dialog is open). */
  page?: string;
}

/** The effective allowlist, or why there is none. */
function allowFor(ctx: CallCtx, narrow: readonly string[] | undefined, page: boolean, roots: Roots): { allow: string[] } | { why: string } {
  const declared = ctx.runs;
  if (declared === undefined || declared.length === 0) {
    // A live page written before `runs` existed (0.1.7): its own list stands until its command declares `runs`.
    if (page && narrow && narrow.length > 0) return { allow: [...narrow] };
    return { why: `"${ctx.path}" declares no runs` };
  }
  if (narrow === undefined) return { allow: [...declared] };
  const canon = narrow.map((entry) => resolvePath(roots, entry.trim().split(/\s+/))?.names.join(" ") ?? entry);
  return { allow: canon.filter((p) => declared.includes(p)) };
}

/** Run `line` for a caller. Never throws; resolves with the line's result, or exit 2 with the reason when refused. */
export async function innerRun(line: string, call: InnerCall, d: InnerDeps): Promise<CommandResult> {
  const from = call.page !== undefined ? `page ${call.page}` : call.ctx?.line ?? "?";
  const refuse = (why: string): CommandResult => {
    d.warn(`run refused (${why}) from ${from}: ${String(line).slice(0, 80)}`);
    return fail(ExitCode.USAGE, `refused: ${why}`);
  };
  try {
    const ctx = call.ctx;
    if (!ctx || !ctx.live.on) return refuse("a line can only be run while a command runs");
    if (ctx.inner) return refuse("no nesting: a line run this way cannot run further lines");
    if (typeof line !== "string") return refuse("not a line");
    const roots = d.roots();
    const allowed = allowFor(ctx, call.narrow, call.page !== undefined, roots);
    if ("why" in allowed) return refuse(allowed.why);
    let defaults: Readonly<Record<string, string>> = {};
    try {
      defaults = (await d.defaults?.()) ?? {};
    } catch {
      defaults = {}; // a broken store never stops a command
    }
    const expanded = expandDefaults(line, defaults);
    const why = refusal(expanded.line, allowed.allow, roots);
    if (why !== null) return refuse(why);
    for (const e of expanded.expansions) d.log(`cmdAbl [run] info: ${e.typed} ⇒ ${e.ran} (default)`);
    const result = await callStore.run({ ...ctx, inner: true }, () => d.exec(expanded.line, call.page !== undefined));
    d.log(`cmdAbl [run] info: run: ${expanded.line.trim()} -> ${result.code} (from ${from})`);
    return result;
  } catch (e: unknown) {
    return fail(ExitCode.FAILURE, `run failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** True when the async context survives an `await` in this host (the Extension Host's Node is trimmed; checked once at startup). */
export async function callStoreWorks(): Promise<boolean> {
  try {
    return await callStore.run({ path: "check", line: "check", inner: false, live: { on: true } }, async () => {
      await Promise.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
      return callStore.getStore()?.path === "check";
    });
  } catch {
    return false;
  }
}
