import type { CommandNode } from "../command/commandTree.js";
import { parse } from "../command/parse.js";
import { pipeAt, splitChain } from "../command/tokenize.js";
import { ExitCode } from "../types.js";
import { logger } from "../log.js";
import type { LiveRun } from "./livePage.js";

// Page runs (plan 0018 "Page runs"): the check behind a live page's `POST /run`. A page may run a line only if every
// `;` part parses to a command whose path (command plus subcommands: "stamp loop") the module listed when it opened the
// page. A bare `|` is refused (it would hide a raw line from the check). An allowed line goes to `run` (headless, one
// undo step, logged, not in the history); a refusal answers exit 2 and logs a warn line. Never throws.

export interface PageRunDeps {
  roots: () => CommandNode<any, any>[];
  /** Runs one allowed line the normal, headless way; answers its exit code and message. */
  run: (line: string) => Promise<{ code: number; text: string }>;
  warn?: (text: string) => void;
}

/** The command path a part addresses ("stamp loop"), or undefined when it does not parse to a runnable command. */
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
