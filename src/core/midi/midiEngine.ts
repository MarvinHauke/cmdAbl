import { appLog } from "../log.js";
import {
  applyOperator,
  controlMatches,
  formatControl,
  initialState,
  operatorGivesValue,
  substituteValue,
  validateBinding,
  type MidiControl,
  type MidiMessage,
  type OperatorName,
  type OperatorState,
} from "./midi.js";
import { ExitCode } from "../types.js";

// The MIDI engine (plan 0018): a table of bindings, and for each incoming message the matching
// bindings' operators decide whether the bound line runs and with which value. The run goes through
// an injected `run` (runHeadless in the extension): no dialogs, exit 4 for an ambiguous address, not
// added to the history. One log line per firing. Nothing here throws.

/** One row of the table: a control, how its messages fire the line, and the line (with `{}` for the value). */
export interface MidiBinding {
  control: MidiControl;
  operator: OperatorName;
  line: string;
  /** A CC (or pitch bend) counts as pressed above this value; default 0. A per-control setting later. */
  threshold?: number;
}

/** What `run` answers (a HeadlessOutcome has more; only these are used). */
export interface RunAnswer {
  code: number;
  message: string;
  /** Surfaces the run tried to open, each dismissed (HeadlessOutcome.dialogs), e.g. `tags "mute: which tags?": #a, #b`. */
  dialogs?: string[];
}

/** What a dismissed surface was, in words: `tags "…": …` → "a tag pick list"; unknown kinds say "a dialog". */
export function dialogKind(entry: string): string {
  const kind = /^[a-z]+/.exec(entry)?.[0];
  switch (kind) {
    case "pick":
      return "a pick list";
    case "tags":
      return "a tag pick list";
    case "page":
      return "a page";
    case "settings":
    case "defaults":
      return "a settings page";
    default:
      return "a dialog";
  }
}

export interface MidiEngineDeps {
  /** Run one command line headless. */
  run: (line: string) => Promise<RunAnswer>;
  /** The `map.enabled` setting; false drops every message. May be async; called once per message that matches a binding. */
  enabled: () => boolean | Promise<boolean>;
  /** Log sink (a finished `cmdAbl [map] level: …` line is written by the logger); default the extension log. */
  log?: { info(text: string): void; warn(text: string): void; debug(text: string): void };
  now?: () => number;
}

/** What happened to one binding for one message (tests, the monitor). */
export interface Firing {
  binding: MidiBinding;
  /** "ran": the line was started (and has finished when `done` resolves); "dropped": same binding still running; "queued": a `hold` value waiting for the running line to finish (a newer one replaces it); "none": the operator did not fire. */
  status: "ran" | "dropped" | "queued" | "none";
  /** The line that ran (`{}` replaced). */
  line?: string;
  code?: number;
  done?: Promise<void>;
}

export interface MidiEngine {
  /**
   * Replace the table; operator state starts again. A row with `{}` and press/release is refused (it stays out):
   * `refused` names each with its reason, `kept` are the rows now in effect.
   */
  setBindings(list: readonly MidiBinding[]): { refused: string[]; kept: MidiBinding[] };
  bindings(): readonly MidiBinding[];
  /** Offer one message to the table. Resolves when every line it started has finished. Never rejects. */
  handle(message: MidiMessage): Promise<Firing[]>;
}

export function createMidiEngine(deps: MidiEngineDeps): MidiEngine {
  const log = deps.log ?? {
    info: (t: string) => appLog.record(`cmdAbl [map] info: ${t}`),
    warn: (t: string) => appLog.record(`cmdAbl [map] warn: ${t}`),
    debug: (t: string) => appLog.record(`cmdAbl [map] debug: ${t}`),
  };
  const now = deps.now ?? (() => Date.now());
  interface Row {
    binding: MidiBinding;
    state: OperatorState;
    running: boolean;
    /** `hold` only: the latest value that arrived while the line was running; it runs once when that line finishes. */
    pending?: { line: string; firing: Firing; resolve: () => void };
  }
  let rows: Row[] = [];
  let order: Promise<unknown> = Promise.resolve();
  /** Bindings already warned about a dialog this session (once each; later firings only get the info line). */
  const warnedDialog = new Set<string>();

  const nameOf = (b: MidiBinding): string => `${formatControl(b.control)} ${b.operator}`;

  return {
    setBindings(list) {
      const problems: string[] = [];
      const kept: Row[] = [];
      // A row that stays the same (control, operator, line) keeps its state: adding another binding does not reset a toggle.
      const sameRow = (b: MidiBinding): Row | undefined =>
        rows.find((r) => r.binding.operator === b.operator && r.binding.line === b.line && formatControl(r.binding.control) === formatControl(b.control));
      for (const binding of list) {
        const problem = validateBinding(binding.operator, binding.line);
        if (problem) {
          problems.push(`${nameOf(binding)}: ${problem}`);
          continue;
        }
        const old = sameRow(binding);
        if (old) {
          old.binding = binding; // the same row object: a line that is running still clears ITS running flag
          kept.push(old);
        } else {
          kept.push({ binding, state: initialState(), running: false });
        }
      }
      rows = kept;
      return { refused: problems, kept: kept.map((r) => r.binding) };
    },

    bindings: () => rows.map((r) => r.binding),

    handle(message) {
      if (message.monitor === true) return Promise.resolve([]); // a monitor-window copy is for the live view, never for a binding
      // Messages are decided one at a time, in arrival order (the enabled check may be async); the lines they start run on their own.
      const turn = order.then(() => decide(message));
      order = turn.then(() => {}, () => {});
      return turn.then(async (firings) => {
        await Promise.all(firings.map((f) => f.done));
        return firings;
      });
    },
  };

  async function decide(message: MidiMessage): Promise<Firing[]> {
    const firings: Firing[] = [];
    try {
      const matching = rows.filter((r) => controlMatches(r.binding.control, message));
      if (matching.length === 0) return firings;
      if (!(await deps.enabled())) return firings;
      for (const row of matching) {
        const { binding } = row;
        const result = applyOperator(binding.operator, message, row.state, { threshold: binding.threshold });
        row.state.down = result.next.down; // the edge is tracked even when the firing is dropped
        if (!result.fire) {
          firings.push({ binding, status: "none" });
          continue;
        }
        if (row.running) {
          if (binding.operator === "hold") {
            // A quick tap: the release must not be lost, or the target stays at 1. Keep the latest value and run it after the current line.
            const line = substituteValue(binding.line, result.value);
            row.pending?.resolve(); // an older waiting value is replaced
            const firing: Firing = { binding, status: "queued", line };
            firing.done = new Promise<void>((resolve) => {
              row.pending = { line, firing, resolve };
            });
            log.debug(`${nameOf(binding)}: queued ${line}, the same binding is still running`);
            firings.push(firing);
          } else {
            log.debug(`${nameOf(binding)}: dropped, the same binding is still running`);
            firings.push({ binding, status: "dropped" });
          }
          continue;
        }
        row.state.on = result.next.on; // a toggle advances only when a run starts
        const line = substituteValue(binding.line, operatorGivesValue(binding.operator) ? result.value : undefined);
        const firing: Firing = { binding, status: "ran", line };
        launch(row, line, firing);
        firings.push(firing);
      }
    } catch (e: unknown) {
      log.warn(`message ignored: ${e instanceof Error ? e.message : String(e)}`);
    }
    return firings;
  }

  /** Start the line of `row` (not running); when it finishes the waiting `hold` value, if any, runs next. Sets `firing.done`. */
  function launch(row: Row, line: string, firing: Firing): void {
    const binding = row.binding;
    row.running = true;
    const started = now();
    firing.done = (async () => {
      try {
        const answer = await deps.run(line);
        firing.code = answer.code;
        const note = answer.code === ExitCode.OK || !answer.message ? "" : `: ${answer.message.split("\n")[0]}`;
        const asked = answer.dialogs?.[0];
        const warnKey = `${nameOf(binding)} ${binding.line}`;
        if (asked !== undefined && !warnedDialog.has(warnKey)) {
          warnedDialog.add(warnKey);
          log.warn(
            `${nameOf(binding)}: "${binding.line}" asked for ${dialogKind(asked)}; MIDI can't show dialogs, so it was cancelled. Bind a concrete line instead, e.g. one that names its target.`,
          );
        }
        log.info(`${nameOf(binding)} -> ${line} -> exit ${answer.code} (${now() - started} ms)${note}`);
      } catch (e: unknown) {
        firing.code = ExitCode.FAILURE;
        log.warn(`${nameOf(binding)} -> ${line} failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        row.running = false;
      }
      const waiting = row.pending;
      row.pending = undefined;
      if (waiting) {
        launch(row, waiting.line, waiting.firing);
        waiting.firing.status = "ran";
        await waiting.firing.done;
        waiting.resolve();
      }
    })();
  }
}
