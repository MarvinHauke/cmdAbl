// The `defaults` surface (plan 0019 §7): building the request from the command tree and the stored defaults, capping it,
// checking the page's answer, the dialog size, and the flow that opens the page, checks what came back and saves it.
// The contract types live in ui.ts. The flow takes the store and the surface as ports, so it is testable without Live.

import { MAX_TEXT } from "./present.js";
import { ExitCode, fail, ok, type CommandResult } from "../types.js";
import { logger } from "../log.js";
import type { CommandNode } from "../command/commandTree.js";
import { bareBehaviour, checkDefaultLine, MAX_LINE, type DefaultEntry, type DefaultsStore } from "../command/defaultCommands.js";
import type { DefaultsAnswer, DefaultsCheck, DefaultsRequest, DefaultsRow, Ui } from "./ui.js";

export const MAX_ROWS = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clip = (value: unknown): string => {
  const t = typeof value === "string" ? value : "";
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
};

/** One row per top-level command, in tree order; `entries` carry the stored lines, `typed` the text of lines that failed a save. */
export function buildDefaultsRequest(
  roots: readonly CommandNode<any, any>[],
  entries: readonly DefaultEntry[],
  options: { title?: string; focus?: string; typed?: Readonly<Record<string, { line: string; error: string }>> } = {},
): DefaultsRequest {
  const byCommand = new Map(entries.map((e) => [e.command, e]));
  const rows: DefaultsRow[] = roots.map((node) => {
    const typed = options.typed?.[node.name];
    const stored = byCommand.get(node.name);
    const line = typed?.line ?? stored?.line ?? "";
    const error = typed?.error ?? stored?.error;
    return { command: node.name, line, summary: node.summary, bareBehaviour: bareBehaviour(node), ...(error !== undefined ? { error } : {}), ...(typed ? { saved: stored?.line ?? "" } : {}) };
  });
  return { title: options.title ?? "Default commands", ...(options.focus !== undefined && rows.some((r) => r.command === options.focus) ? { focus: options.focus } : {}), rows };
}

/** The request as the page gets it: at most 200 rows, texts at most 300 characters, rows without a command dropped. */
export function capDefaults(request: DefaultsRequest): { request: DefaultsRequest; cut: boolean } {
  let cut = false;
  const seen = new Set<string>();
  const rows: DefaultsRow[] = [];
  for (const row of Array.isArray(request.rows) ? request.rows : []) {
    const command = typeof row?.command === "string" && row.command !== "" && row.command.length <= MAX_TEXT ? row.command : "";
    if (!command || seen.has(command) || rows.length >= MAX_ROWS) {
      cut = true;
      continue;
    }
    seen.add(command);
    const out: DefaultsRow = { command, line: clip(row.line), summary: clip(row.summary), bareBehaviour: clip(row.bareBehaviour) };
    if (out.line !== row.line || out.summary !== row.summary) cut = true;
    if (typeof row.error === "string" && row.error !== "") out.error = clip(row.error);
    if (typeof row.saved === "string") {
      out.saved = clip(row.saved);
      if (out.saved !== row.saved) cut = true;
    }
    rows.push(out);
  }
  const focus = typeof request.focus === "string" && seen.has(request.focus) ? request.focus : undefined;
  return { request: { title: clip(request.title), ...(focus !== undefined ? { focus } : {}), rows }, cut };
}

/**
 * The page's answer, checked against the request it was given. Null for anything that is not an answer object (empty =
 * closed with Esc); never throws. `changes` keeps only commands of the request's rows, text values (trimmed, at most
 * `MAX_LINE` characters; '' removes) that differ from the row's line.
 */
export function parseDefaultsAnswer(raw: string | null | undefined, request: DefaultsRequest, log: (line: string) => void = (line) => logger("defaults").warn(line)): DefaultsAnswer | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    log(`malformed defaults answer: ${raw.slice(0, 80)}`);
    return null;
  }
  if (!isRecord(value)) {
    log("defaults answer is not an object");
    return null;
  }
  const rows = new Map(request.rows.map((r) => [r.command, r]));
  const changes: Record<string, string> = Object.create(null) as Record<string, string>;
  if (isRecord(value.changes)) {
    for (const [command, v] of Object.entries(value.changes)) {
      const row = rows.get(command);
      if (!row || typeof v !== "string") continue;
      const line = v.trim();
      if (line.length > MAX_LINE || line === (row.saved ?? row.line).trim()) continue;
      changes[command] = line;
    }
  } else if (value.changes !== undefined) {
    log("defaults answer has changes that are not an object");
  }
  return { changes: { ...changes } };
}

/** Dialog size: a row is about 44 px; the page scrolls beyond the maximum. A height inherited from the settings page never shrinks it. */
export function defaultsSize(request: DefaultsRequest): { width: number; height: number } {
  const own = Math.min(Math.max(150 + request.rows.length * 44, 280), 600);
  return { width: 640, height: request.height === undefined ? own : Math.min(Math.max(request.height, own), 600) };
}

const savedText = (set: number, removed: number): string => {
  const parts: string[] = [];
  if (set > 0) parts.push(`${set} default command${set === 1 ? "" : "s"} saved`);
  if (removed > 0) parts.push(`${removed} default command${removed === 1 ? "" : "s"} removed`);
  return parts.join(", ");
};

export interface DefaultsFlowDeps {
  store: DefaultsStore;
  ui: Pick<Ui, "defaults">;
  /** The command tree (read at each open). */
  roots: () => CommandNode<any, any>[];
  log?: (line: string) => void;
}

export interface DefaultsFlow {
  /**
   * Show the defaults page. `focus` is a top-level command (exit 3 when there is none). What the page answers is checked
   * again; valid lines are saved, and when any is invalid the page opens again on that row with the text and the error
   * (until it is fixed or the page is closed). Answers quietly (the count goes to the log; lines that stay invalid are told), or exit 1 when the file
   * could not be written; closing without Enter changes nothing and says nothing. Never throws.
   */
  open(options?: { focus?: string; height?: number }): Promise<CommandResult>;
  /** A link row's target (`defaults` or `defaults:<command>`) from the settings page; anything else is exit 3. */
  openTarget(target: string, window?: { height: number }): Promise<CommandResult>;
  /** The live check for the page (also what the check after closing uses). */
  check: DefaultsCheck;
  /** How many usable defaults there are, and the line of one command ("" = none). */
  summary(): Promise<{ count: number; lines: Record<string, string> }>;
}

export function createDefaultsFlow(deps: DefaultsFlowDeps): DefaultsFlow {
  const warn = deps.log ?? ((line: string) => logger("defaults").warn(line));
  const check: DefaultsCheck = (command, line) => {
    try {
      const error = deps.roots().some((n) => n.name === command) ? checkDefaultLine(command, line, deps.roots()) : `no command "${command}"`;
      return error === null ? { ok: true } : { ok: false, error };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
  const flow: DefaultsFlow = {
    check,
    async summary() {
      try {
        const lines = await deps.store.get();
        const names = new Set(deps.roots().map((n) => n.name));
        const known = Object.fromEntries(Object.entries(lines).filter(([c]) => names.has(c)));
        return { count: Object.keys(known).length, lines: known };
      } catch {
        return { count: 0, lines: {} };
      }
    },
    async open(options = {}) {
      try {
        if (options.focus !== undefined && !deps.roots().some((n) => n.name === options.focus)) {
          return fail(ExitCode.NOT_FOUND, `config defaults: no command "${options.focus}"`);
        }
        let focus = options.focus;
        let typed: Record<string, { line: string; error: string }> = {};
        let set = 0;
        let removed = 0;
        const logLines: string[] = [];
        for (let round = 0; round < 20; round++) {
          const built = buildDefaultsRequest(deps.roots(), await deps.store.entries(), { focus, typed });
          const { request: capped, cut } = capDefaults(built);
          const request = options.height !== undefined ? { ...capped, height: options.height } : capped;
          if (cut) warn("defaults: the page was cut (more than 200 commands or texts over 300 characters)");
          const answer = await deps.ui.defaults(request, check);
          if (!answer) break;
          const changes: Record<string, string> = { ...answer.changes };
          // A typed line left as it is differs from the row's `saved`, so the page reports it again and it is checked (and fails) again;
          // one put back to `saved` is no change and drops out.
          const valid: Record<string, string> = {};
          const nextTyped: Record<string, { line: string; error: string }> = {};
          for (const [command, line] of Object.entries(changes)) {
            const error = line === "" ? null : (() => {
              const c = check(command, line);
              return c.ok ? null : c.error;
            })();
            if (error === null) valid[command] = line;
            else nextTyped[command] = { line, error };
          }
          typed = nextTyped;
          if (Object.keys(valid).length > 0) {
            if (!(await deps.store.set(valid))) return fail(ExitCode.FAILURE, "config defaults: the default commands could not be saved (they stay in effect until Live restarts)");
            for (const [command, line] of Object.entries(valid)) {
              if (line === "") removed++;
              else set++;
              logLines.push(line === "" ? `default ${command} removed` : `default ${command} = ${line}`);
            }
          }
          const firstBad = Object.keys(typed)[0];
          if (firstBad === undefined) break;
          focus = firstBad; // reopen on the row that did not parse, with the text and the error
        }
        const left = Object.entries(typed);
        if (left.length > 0) {
          logLines.push(...left.map(([c, t]) => `default ${c} not saved: ${t.error}`));
          warn(`defaults: ${left.length} line(s) not saved (${left.map(([c]) => c).join(", ")})`);
        }
        const notSaved = left.length > 0 ? `${left.length} not saved (${left.map(([c]) => c).join(", ")})` : "";
        // A successful save is quiet: the count goes to the log. Lines that stay invalid are still told.
        if (set + removed > 0) logLines.unshift(savedText(set, removed));
        const result = notSaved ? ok(notSaved) : ok();
        return logLines.length > 0 ? { ...result, log: logLines } : result;
      } catch (e: unknown) {
        return fail(ExitCode.FAILURE, `config defaults: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async openTarget(target, window) {
      const height = window ? { height: window.height } : {};
      if (target === "defaults") return flow.open(height);
      if (target.startsWith("defaults:")) return flow.open({ focus: target.slice("defaults:".length), ...height });
      return fail(ExitCode.NOT_FOUND, `config: unknown page "${target}"`);
    },
  };
  return flow;
}
