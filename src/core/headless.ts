import { appLog, type Log } from "./log.js";
import { runLine, type RunDeps } from "./run.js";
import { presentResult } from "./present.js";
import { uniquePath } from "../ableton/resolvePath.js";
import { ExitCode, fail, type CommandResult } from "./types.js";
import type { Ui } from "./ui.js";

// A run without a screen (plan 0016): the same `runLine`, but no dialog ever opens. A pick that a
// person would answer ends the run with exit 4 and the candidates in the message, so a test sees
// why; every other surface (prompt, select, board, page — and so `api.confirm`) counts as
// dismissed, and the outcome names what the command tried to open. `notify` is captured.
// Nothing here is tied to a route: any non-interactive caller can use it.

/** What a headless run answers. */
export interface HeadlessOutcome {
  code: number;
  /** The text the palette would show (empty for a silent success). */
  message: string;
  /** The log lines the run wrote, oldest first. */
  log: string[];
  /** Every surface the command tried to open (each was dismissed), e.g. `pick "goto: "kick" matches 2": /Kick#1, /Kick#2`. */
  dialogs: string[];
  /** Messages a module showed with `showFeedback` / `notify` during the run. */
  notices: string[];
  ms: number;
}

interface Capture {
  dialogs: string[];
  notices: string[];
}

/** A `Ui` that can be switched headless for the duration of one run. */
export interface UiGate {
  ui: Ui;
  /** True while a headless run is going: nothing else may open a dialog then. */
  active(): boolean;
  /** Run `fn` with every surface headless; dialogs and notices go to `capture`. */
  within<T>(capture: Capture, fn: () => Promise<T>): Promise<T>;
}

const SHOWN = 6;
const listOf = (labels: string[]): string => (labels.length <= SHOWN ? labels.join(", ") : `${labels.slice(0, SHOWN).join(", ")}, … (${labels.length} in all)`);

/** Wrap the real `Ui`: it passes everything through until `within` switches it. */
export function createUiGate(real: Ui): UiGate {
  let capture: Capture | null = null;
  const shut = (what: string): null => {
    capture?.dialogs.push(what);
    return null;
  };
  const ui: Ui = {
    prompt: (request) => (capture ? Promise.resolve(shut("palette")) : real.prompt(request)),
    select: (request) =>
      capture ? Promise.resolve(shut(`pick "${request.title}": ${listOf(request.items.map((i) => i.label))}`)) : real.select(request),
    notify: (request) => {
      if (capture) capture.notices.push(request.text);
      else real.notify(request);
    },
    board: (request) => (capture ? Promise.resolve(shut(`board "${request.title}"`)) : real.board(request)),
    page: (name, html, width, height) => (capture ? Promise.resolve(shut(`page "${name}"`)) : real.page(name, html, width, height)),
  };
  return {
    ui,
    active: () => capture !== null,
    async within(into, fn) {
      capture = into;
      try {
        return await fn();
      } finally {
        capture = null;
      }
    },
  };
}

export interface HeadlessOptions {
  log?: Pick<Log, "mark" | "since">;
  now?: () => number;
}

/**
 * Run one line headless. `deps` is what the palette's run uses, without its two pick surfaces
 * (they are replaced here). Never throws and never opens a dialog.
 */
export async function runHeadless(
  line: string,
  deps: Omit<RunDeps, "pick" | "pickTags" | "takeFill">,
  gate: UiGate,
  options: HeadlessOptions = {},
): Promise<HeadlessOutcome> {
  const log = options.log ?? appLog;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const mark = log.mark();
  const capture: Capture = { dialogs: [], notices: [] };
  /** What a person would have been asked, as candidate text for the message. */
  const asked: string[] = [];

  const runDeps: RunDeps = {
    ...deps,
    pick: async ({ title, candidates, nodes }) => {
      const labels = candidates.map((c) => uniquePath(nodes, c));
      asked.push(`${title}\n  ${labels.join("\n  ")}`);
      capture.dialogs.push(`pick "${title}": ${listOf(labels)}`);
      return null;
    },
    pickTags: async ({ title, tags }) => {
      const names = tags.map((t) => `#${t.name}`);
      asked.push(`${title}\n  ${names.join("\n  ")}`);
      capture.dialogs.push(`tags "${title}": ${listOf(names)}`);
      return null;
    },
  };

  let result: CommandResult;
  try {
    const outcome = await gate.within(capture, () => runLine(line, runDeps));
    result = outcome.result;
    if (asked.length > 0) {
      if (outcome.cancelled) {
        result = fail(ExitCode.AMBIGUOUS, `ambiguous: ${asked.join("\n")}`);
      } else if (result.code !== ExitCode.OK) {
        // A suggestion list ("did you mean"): the command's own failure stands, with the candidates.
        result = { ...result, message: `${result.message ?? "failed"}\n${asked.join("\n")}` };
      }
    } else if (outcome.cancelled) {
      result = fail(ExitCode.FAILURE, "cancelled: the command needed an answer");
    }
  } catch (e: unknown) {
    result = fail(ExitCode.FAILURE, `run failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  let message = "";
  presentResult(result, (text) => {
    message = text;
  });
  return {
    code: result.code,
    message,
    log: log.since(mark),
    dialogs: capture.dialogs,
    notices: capture.notices,
    ms: now() - started,
  };
}
