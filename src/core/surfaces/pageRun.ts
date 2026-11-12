import type { CommandNode } from "../command/commandTree.js";
import { parse } from "../command/parse.js";
import { pipeAt, splitChain } from "../command/tokenize.js";
import { ExitCode } from "../types.js";
import { logger } from "../log.js";
import type { LiveRun, LiveSession } from "./livePage.js";

// Page runs (plan 0018 "Page runs"): the check behind a live page's `POST /run`. A page may run a line only if every
// `;` part parses to a command whose path (command plus subcommands: "loop here") the module listed when it opened the
// page. A bare `|` is refused (it would hide a raw line from the check). An allowed line goes to `run` (headless, one
// undo step, logged, not in the history); a refusal answers exit 2 and logs a warn line. Never throws.

export interface PageRunDeps {
  roots: () => CommandNode<any, any>[];
  /** Runs one allowed line the normal, headless way; answers its exit code and message. */
  run: (line: string) => Promise<{ code: number; text: string }>;
  warn?: (text: string) => void;
}

/** The command path a part addresses ("loop here"), or undefined when it does not parse to a runnable command. */
function pathOf(part: string, roots: CommandNode<any, any>[]): string | undefined {
  const parsed = parse(part, roots);
  return parsed.kind === "run" ? parsed.invocation.path.join(" ") : undefined;
}

/** Why `line` may not run for `allow`, or null when every part is allowed. */
export function refusal(line: string, allow: readonly string[], roots: CommandNode<any, any>[]): string | null {
  if (pipeAt(line) >= 0) return "a bare | is not allowed here";
  const parts = splitChain(line);
  if (parts.length === 0) return "empty line";
  for (const part of parts) {
    const path = pathOf(part.text, roots);
    if (path === undefined) return `not a runnable command: ${part.text}`;
    if (!allow.includes(path)) return `"${path}" is not allowed from this page`;
  }
  return null;
}

/** Builds the handler for one page's allowlist. */
export function createPageRun(deps: PageRunDeps): (allow: string[]) => LiveRun {
  const log = logger("live");
  const warn = deps.warn ?? ((text: string) => log.warn(text));
  return (allow) => async (line) => {
    try {
      const why = refusal(line, allow, deps.roots());
      if (why !== null) {
        warn(`page run refused (${why}): ${line.slice(0, 80)}`);
        return { code: ExitCode.USAGE, text: `refused: ${why}` };
      }
      return await deps.run(line);
    } catch (e: unknown) {
      return { code: ExitCode.FAILURE, text: `run failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  };
}

/**
 * Wraps a page-run handler so the opener can wait for runs in flight: `idle()` resolves once every run started so far
 * (and any started while waiting) has finished, or `maxMs` has passed (then false). Without a handler `run` is undefined and `idle()` resolves at once.
 */
export function trackRuns(handler: LiveRun | undefined): { run: LiveRun | undefined; idle: (maxMs?: number) => Promise<boolean>; started: () => number } {
  let started = 0;
  const inflight = new Set<Promise<unknown>>();
  const run: LiveRun | undefined = handler
    ? (line) => {
        started++;
        const p = handler(line);
        const settled = p.then(() => undefined, () => undefined);
        inflight.add(settled);
        void settled.then(() => inflight.delete(settled));
        return p;
      }
    : undefined;
  return {
    run,
    started: () => started,
    // Resolves true when nothing is left, false when `maxMs` (default 3 s) passed first: a stuck run must not hold the dialog result forever.
    idle: async (maxMs = 3000) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<false>((r) => (timer = setTimeout(() => r(false), maxMs)));
      const drained = (async () => {
        while (inflight.size > 0) await Promise.all([...inflight]);
        return true as const;
      })();
      try {
        return await Promise.race([drained, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface RunLivePageDeps {
  name: string;
  /** The command paths the page may run while open. */
  run?: string[];
  /** One line to run after the close (plan 0026 "Safety net"); must pass the same allowlist check as a page run. */
  onClose?: string;
  pageRun?: (allow: string[]) => LiveRun;
  open: (handler: LiveRun | undefined) => LiveSession | null;
  showData: () => Promise<string | null>;
  showLive: (session: LiveSession) => Promise<string | null>;
}

/**
 * The flow behind `ui.livePage`: open the session, show the dialog, end the token, wait for page runs in flight, then
 * run `onClose` once, only if the page made at least one run (whatever it answered, also on dismiss; headless, logged, never throws; its result is only logged).
 */
export async function runLivePage(d: RunLivePageDeps): Promise<string | null> {
  const log = logger("ui");
  const allow = d.run?.filter((p) => typeof p === "string" && p.trim() !== "");
  const onClose = d.onClose?.trim() || undefined;
  if (onClose && !d.pageRun) log.warn(`live page "${d.name}": onClose cannot run (no page-run handler): ${onClose.slice(0, 80)}`);
  // The dialog's result waits for page runs in flight (plan 0018 "Page runs").
  const runs = trackRuns(allow && allow.length > 0 && d.pageRun ? d.pageRun(allow) : undefined);
  let answer: string | null = null;
  try {
    const session = d.open(runs.run);
    if (!session) {
      answer = (await d.showData()) || null;
    } else {
      try {
        answer = (await d.showLive(session)) || null;
      } finally {
        session.close(); // the token and the routes end with the dialog: no new run can start
        if (!(await runs.idle())) log.warn(`live page "${d.name}": a page run was still running 3 s after the close`); // runs already started finish first
      }
    }
  } finally {
    if (onClose && d.pageRun && runs.started() > 0) {
      try {
        const result = await d.pageRun(allow ?? [])(onClose);
        log.info(`live page "${d.name}": onClose "${onClose.slice(0, 80)}" -> ${result.code}${result.text ? ` ${result.text}` : ""}`);
      } catch (e: unknown) {
        log.warn(`live page "${d.name}": onClose failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return answer;
}
