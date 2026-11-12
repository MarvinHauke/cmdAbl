import type { CommandNode } from "../command/commandTree.js";
import { callStore, innerRun, refusal } from "../command/innerRun.js";
import type { CommandResult } from "../types.js";
import { logger } from "../log.js";
import type { LiveRun, LiveSession } from "./livePage.js";

// Page runs (plan 0018 "Page runs", unified with module runs in plan 0028): a live page's `POST /run` is an inner run
// whose caller is the page. The check and the run are `innerRun` (command/innerRun.ts): every `;` part must parse to a
// command whose path is in the calling command's `runs`, narrowed by the page's own list, and not `outside`. A bare `|`
// is refused. A refusal answers exit 2 and logs a warn line. Page runs are always headless. Never throws.

export { refusal };

export interface PageRunDeps {
  roots: () => CommandNode<any, any>[];
  /** Runs one allowed line headless; answers its result. */
  exec: (line: string, headless: boolean) => Promise<CommandResult>;
  /** The default commands, expanded before the check (see `InnerDeps.defaults`). */
  defaults?: () => Promise<Readonly<Record<string, string>>>;
  log?: (line: string) => void;
  warn?: (text: string) => void;
}

/**
 * Builds the handler for one page. Call it while the opening command runs (inside `ui.livePage`): that command is the
 * caller of every run the page makes.
 */
export function createPageRun(deps: PageRunDeps): (allow: string[], pageName: string) => LiveRun {
  const log = logger("live");
  const warn = deps.warn ?? ((text: string) => log.warn(text));
  return (allow, pageName) => {
    const ctx = callStore.getStore();
    return async (line) => {
      const result = await innerRun(line, { ctx, narrow: allow, page: pageName }, { roots: deps.roots, exec: deps.exec, defaults: deps.defaults, log: deps.log ?? ((l) => log.info(l.replace(/^cmdAbl \[run\] info: /, ""))), warn });
      return { code: result.code, text: result.message ?? "" };
    };
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
  pageRun?: (allow: string[], pageName: string) => LiveRun;
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
  const runs = trackRuns(allow && allow.length > 0 && d.pageRun ? d.pageRun(allow, d.name) : undefined);
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
        const result = await d.pageRun(allow ?? [], d.name)(onClose);
        log.info(`live page "${d.name}": onClose "${onClose.slice(0, 80)}" -> ${result.code}${result.text ? ` ${result.text}` : ""}`);
      } catch (e: unknown) {
        log.warn(`live page "${d.name}": onClose failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return answer;
}
