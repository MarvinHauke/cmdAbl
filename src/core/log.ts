// The one logger (plan 0011). Every log line of cmdAbl goes through here; no other file calls
// `console.` (src/architecture.test.ts). A line reads `cmdAbl [<source>] <level>: <text>`.
// The last 500 lines are kept in memory for `cmdabl log`; `debug` lines exist only after
// `cmdabl log --debug` turned them on for the session. Never log a token, a secret or an
// environment value: the reviewer checks this on every change.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(text: string): void;
  info(text: string): void;
  warn(text: string): void;
  error(text: string): void;
}

export const LOG_CAPACITY = 500;

/** Where a finished line goes (the extension's console in production, an array in tests). */
export type LogSink = (line: string, level: LogLevel, time: number) => void;

/** One kept line with the time (ms since the epoch) it was written. */
export interface LogEntry {
  time: number;
  line: string;
}

const two = (n: number): string => String(n).padStart(2, "0");
/** Local time `HH:MM:SS`, or `HH:MM:SS.mmm` with `millis`. */
export function clockText(time: number, millis = false): string {
  const d = new Date(time);
  const base = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return millis ? `${base}.${String(d.getMilliseconds()).padStart(3, "0")}` : base;
}
/** Local date `YYYY-MM-DD`. */
export function dayText(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export interface Log {
  /** A logger whose lines carry `source` (a module, `run`, `ui`, …). */
  logger(source: string): Logger;
  /** Record a line somebody else already formatted (for injected line sinks); its level is read from the line, default info. */
  record(line: string, level?: LogLevel): void;
  /** The last `count` lines kept, oldest first (all of them when `count` is omitted). */
  lines(count?: number): string[];
  /** Like `lines`, with the time each line was written. */
  entries(count?: number): LogEntry[];
  /** Turn debug lines on or off for the session. */
  setDebug(on: boolean): void;
  debugOn(): boolean;
}

/** The only place that touches the console. */
export const consoleSink: LogSink = (line, level, time) => {
  const stamped = `${clockText(time, true)} ${line}`;
  if (level === "error" || level === "warn") console.error(stamped);
  else console.log(stamped);
};

const pick = <T>(items: T[], count?: number): T[] => (count === undefined ? [...items] : count <= 0 ? [] : items.slice(-count));

export function createLog(sink: LogSink = consoleSink, capacity = LOG_CAPACITY, now: () => number = Date.now): Log {
  const buffer: LogEntry[] = [];
  let debug = false;

  const write = (line: string, level: LogLevel): void => {
    const time = now();
    buffer.push({ time, line });
    if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
    try {
      sink(line, level, time);
    } catch {
      // a failing sink must never break the caller
    }
  };
  /** One entry per line of text; blank lines are skipped. */
  const emit = (source: string, level: LogLevel, text: unknown): void => {
    if (level === "debug" && !debug) return;
    for (const part of String(text).split("\n")) {
      if (part.trim()) write(`cmdAbl [${source}] ${level}: ${part}`, level);
    }
  };

  return {
    logger: (source) => ({
      debug: (text) => emit(source, "debug", text),
      info: (text) => emit(source, "info", text),
      warn: (text) => emit(source, "warn", text),
      error: (text) => emit(source, "error", text),
    }),
    record: (line, level) => {
      for (const part of String(line).split("\n")) {
        if (!part.trim()) continue;
        // The level comes from the line itself (`cmdAbl [src] warn: …`) unless given; default info.
        const found = /^cmdAbl \[[^\]]*\] (debug|info|warn|error):/.exec(part)?.[1] as LogLevel | undefined;
        const lineLevel = level ?? found ?? "info";
        if (lineLevel === "debug" && !debug) continue;
        write(part, lineLevel);
      }
    },
    lines: (count) => pick(buffer, count).map((e) => e.line),
    entries: (count) => pick(buffer, count).map((e) => ({ ...e })),
    setDebug: (on) => {
      debug = on;
    },
    debugOn: () => debug,
  };
}

/** The extension's log. */
export const appLog: Log = createLog();

export const logger = (source: string): Logger => appLog.logger(source);
