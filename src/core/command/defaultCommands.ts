import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { CommandNode } from "./commandTree.js";
import { fallbackOf, parse } from "./parse.js";
import { chainSegments, pipeAt, splitChain, tokenize } from "./tokenize.js";

// Default commands (plan 0019 §7): a bare command word runs a line the user chose (`mute` runs `mute #drums`).
// This file holds what is pure about it: the check of a line, the store of `default_commands.json` and the expansion
// step that runs in core before parsing. Modules never see any of it.

export const DEFAULTS_FILE = "default_commands.json";
/** Longest default line (and so the longest text the defaults page sends). */
export const MAX_LINE = 300;
/** Most defaults the completion snapshot carries. */
export const MAX_DEFAULTS = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** The first line of a (possibly multi-line) usage message: the error without its `usage:` tail. */
const firstLine = (text: string): string => text.split("\n")[0]!.trim();

/**
 * Why `line` is no default for `command`, or null when it is one. It must be a line that parses against the tree
 * (targets are NOT resolved, so a tag that does not exist yet is fine) and start with its own command: `mute` →
 * `solo #x` is an alias (0008), not a default. A `;` chain is allowed; every part must parse. Never throws.
 */
export function checkDefaultLine(command: string, line: unknown, roots: CommandNode<any, any>[]): string | null {
  try {
    if (typeof line !== "string") return "the line must be text";
    const text = line.trim();
    if (text === "") return "the line is empty";
    if (text.length > MAX_LINE) return `the line is longer than ${MAX_LINE} characters`;
    const parts = splitChain(text);
    if (parts.length === 0) return "the line is empty";
    const first = tokenize(parts[0]!.text);
    if (!first.ok) return first.error;
    const head = first.tokens[0];
    if (!head || head.quoted || head.value !== command || parts[0]!.text.slice(0, head.end) !== command) {
      return `a default must start with its own command "${command}"`;
    }
    for (const part of parts) {
      const parsed = parse(part.text, roots);
      if (parsed.kind === "error") return firstLine(parsed.result.message ?? "does not parse");
      if (parsed.kind === "help") return `"${part.text}" only shows help; a default must run something`;
    }
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** What a bare top-level command does today, in a few words (shown next to its default; a default replaces it). */
export function bareBehaviour(node: CommandNode<any, any>): string {
  if ((node.children?.length ?? 0) > 0 && !fallbackOf(node)) return "shows its subcommands";
  const required = (node.args ?? []).find((a) => a.required !== false && !a.raw);
  if (required) return `needs <${required.name}>`;
  return "runs on its own";
}

// ── expansion ───────────────────────────────────────────────────────────────

/** One bare word that was replaced: `typed` is the word, `ran` the line it stands for. */
export interface Expansion {
  typed: string;
  ran: string;
}

/**
 * Replace each bare top-level command word of `input` by its default. Each `;` part stands on its own; a part
 * that is more than the one word (`mute bass`, `mute --set 1`), is quoted, starts with `\` (`\mute` skips the
 * default) or holds a `|` is left alone, and so is everything after a top-level `|` (that is a binding's line,
 * expanded when it fires). The result is NOT expanded again. Never throws; `input` comes back unchanged on a surprise.
 */
export function expandDefaults(input: string, defaults: Readonly<Record<string, string>>): { line: string; expansions: Expansion[] } {
  const expansions: Expansion[] = [];
  try {
    if (Object.keys(defaults).length === 0) return { line: input, expansions };
    let out = "";
    let at = 0;
    for (const { start, end } of chainSegments(input)) {
      const raw = input.slice(start, end);
      const text = raw.trim();
      if (text === "" || text.startsWith("\\") || pipeAt(text) >= 0) continue;
      const tokens = tokenize(text);
      const only = tokens.ok && tokens.tokens.length === 1 ? tokens.tokens[0]! : undefined;
      // The raw text must be exactly the word: no quotes, no backslash inside it.
      if (!only || only.quoted || only.value !== text || !has(defaults, text)) continue;
      const line = defaults[text];
      if (typeof line !== "string" || line.trim() === "") continue;
      const lead = raw.length - raw.trimStart().length;
      out += input.slice(at, start + lead) + line.trim();
      at = start + lead + text.length;
      expansions.push({ typed: text, ran: line.trim() });
    }
    return expansions.length === 0 ? { line: input, expansions } : { line: out + input.slice(at), expansions };
  } catch {
    return { line: input, expansions: [] };
  }
}

// ── the store ───────────────────────────────────────────────────────────────

/** One entry of the file for a command: the line, and why it is not usable (hand edits). */
export interface DefaultEntry {
  command: string;
  line: string;
  error?: string;
}

export interface DefaultsStore {
  /** The usable defaults, `command → line` (re-read when the file changed since). */
  get(): Promise<Record<string, string>>;
  /** The usable defaults as of the last load or `set`, without reading the file (for synchronous callers). */
  peek(): Record<string, string>;
  /** Every entry of the file whose value is text, usable or not (an invalid one carries its `error`). */
  entries(): Promise<DefaultEntry[]>;
  /**
   * Set (`line`) or remove (`""`) defaults and save. The lines are NOT checked here (the flow does that); entries it does not
   * touch stay as they are, unknown ones too. Resolves true when saved; the new values are in effect at once either way.
   */
  set(changes: Readonly<Record<string, string>>): Promise<boolean>;
}

export interface DefaultsDeps {
  /** The extension's data folder. */
  base: string;
  /** The command tree a line is checked against (read at each load, so a later `commands.add` counts). */
  roots: () => CommandNode<any, any>[];
  warn: (text: string) => void;
  fs?: Pick<typeof fsp, "readFile" | "writeFile" | "mkdir" | "rename" | "unlink" | "stat">;
}

export function createDefaultsStore(deps: DefaultsDeps): DefaultsStore {
  const fs = deps.fs ?? fsp;
  const file = path.join(deps.base, DEFAULTS_FILE);
  /** Everything in the file, usable or not. */
  let raw: Record<string, unknown> | null = null;
  let seen: string | null = null;
  let saving: Promise<boolean> = Promise.resolve(true);
  /** The checked entries of `raw`; rebuilt with every load and every set. */
  let entries: DefaultEntry[] = [];

  async function stamp(): Promise<string> {
    try {
      const st = await fs.stat(file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return "missing";
    }
  }

  function check(content: Record<string, unknown>, warn: boolean): DefaultEntry[] {
    const roots = deps.roots();
    const out: DefaultEntry[] = [];
    for (const [command, value] of Object.entries(content)) {
      if (typeof value !== "string") continue; // kept in the file, not an entry
      const error = checkDefaultLine(command, value, roots);
      if (error !== null && warn) deps.warn(`default commands: "${command}" → "${value.slice(0, 80)}" is ignored (${error})`);
      out.push({ command, line: value, ...(error !== null ? { error } : {}) });
    }
    return out;
  }

  async function load(): Promise<Record<string, unknown>> {
    seen = await stamp(); // before the read: a change in between is picked up by the next call
    let text: string | null = null;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") deps.warn(`default commands: cannot read ${DEFAULTS_FILE} (${code ?? "error"}); no defaults`);
    }
    let content: Record<string, unknown> = {};
    if (text !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (isRecord(parsed)) content = { ...parsed };
      else deps.warn(`default commands: ${DEFAULTS_FILE} is not a JSON object; no defaults`);
    }
    entries = check(content, true);
    return content;
  }

  async function write(content: Record<string, unknown>): Promise<boolean> {
    const temp = path.join(deps.base, `.${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      await fs.mkdir(deps.base, { recursive: true });
      await fs.writeFile(temp, `${JSON.stringify(content, null, 2)}\n`, "utf8");
      await fs.rename(temp, file);
      seen = await stamp(); // our own write is not an outside edit
      return true;
    } catch (e: unknown) {
      deps.warn(`default commands: cannot write ${DEFAULTS_FILE} (${(e as NodeJS.ErrnoException)?.code ?? "error"})`);
      await fs.unlink(temp).catch(() => {});
      return false;
    }
  }

  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = lock.then(work, work);
    lock = run.then(() => {}, () => {});
    return run;
  };

  async function current(): Promise<Record<string, unknown>> {
    await saving;
    try {
      if (raw === null || (await stamp()) !== seen) raw = await load();
    } catch (e: unknown) {
      deps.warn(`default commands: ${e instanceof Error ? e.message : String(e)}`);
      raw = raw ?? {};
    }
    return raw;
  }

  const usable = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const e of entries) if (e.error === undefined) out[e.command] = e.line.trim();
    return out;
  };

  return {
    peek: () => usable(),
    get: () =>
      exclusive(async () => {
        await current();
        return usable();
      }),
    entries: () =>
      exclusive(async () => {
        await current();
        return entries.map((e) => ({ ...e }));
      }),
    set: (changes) =>
      exclusive(async () => {
        const content = await current();
        let changed = false;
        for (const [command, line] of Object.entries(changes)) {
          if (typeof line !== "string" || command === "" || command === "__proto__") continue;
          if (line.trim() === "") {
            if (has(content, command)) {
              delete content[command];
              changed = true;
            }
          } else if (content[command] !== line.trim()) {
            content[command] = line.trim();
            changed = true;
          }
        }
        if (!changed) return saving;
        entries = check(content, false); // in effect at once
        saving = saving.then(() => write(content));
        return saving;
      }),
  };
}
