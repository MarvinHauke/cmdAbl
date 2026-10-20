import { appLog } from "./log.js";
// One dialog at a time. The SDK's showModalDialog is not known to cope with a
// second call while a modal is open (the promise may never settle), so every
// dialog of the default UI goes through this queue: a dialog is opened only
// after the previous one closed. Pure — the log sink and the clock are
// injected — so it is testable without Live.

export interface DialogQueue {
  /**
   * Run `task` (which opens a dialog and resolves when it closes) after every
   * earlier dialog closed. Rejections reach the caller but never block the queue.
   */
  run<T>(name: string, task: () => Promise<T>): Promise<T>;
  /** What is open or waiting, e.g. "palette" or "message (open), pick (queued)"; null when idle. */
  describe(): string | null;
  /** Called whenever the last open or queued dialog is gone. */
  onIdle(listener: () => void): void;
  /**
   * Manual diagnostic for a dialog that never closed: forget the open and the
   * queued dialogs, so the next one opens a new modal. Their callers get a
   * rejection (the default UI turns it into "dismissed"). If an abandoned
   * dialog settles later, its result is dropped. Returns what was open, or
   * null when nothing was.
   */
  reset(): { name: string; openForMs: number } | null;
}

interface Entry {
  name: string;
  running: boolean;
  openedAt: number;
  /** Rejects the caller's promise (used by reset). */
  abandon: () => void;
}

export function createDialogQueue(
  sink: (line: string) => void = (line) => appLog.record(line),
  now: () => number = () => Date.now(),
): DialogQueue {
  // A throwing log sink must never leave a caller unsettled.
  const log = (line: string): void => {
    try {
      sink(line);
    } catch {
      // ignore
    }
  };
  let entries: Entry[] = [];
  const idleListeners: Array<() => void> = [];
  let tail: Promise<unknown> = Promise.resolve();
  let lastClosedAt: number | undefined;

  function notifyIdle(): void {
    for (const listener of idleListeners) {
      try {
        listener();
      } catch (e: unknown) {
        log(`cmdAbl [dialog] warn: idle listener failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  function finish(entry: Entry): void {
    lastClosedAt = now();
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (entries.length === 0) notifyIdle();
  }

  function describe(): string | null {
    if (entries.length === 0) return null;
    if (entries.length === 1) return entries[0]!.name;
    return entries.map((e) => `${e.name} (${e.running ? "open" : "queued"})`).join(", ");
  }

  return {
    run<T>(name: string, task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const entry: Entry = {
          name,
          running: false,
          openedAt: 0,
          abandon: () => {
            if (settled) return;
            settled = true;
            reject(new Error("dialog queue reset"));
          },
        };
        entries.push(entry);

        const step = tail.then(async () => {
          if (settled) return; // reset while it was still queued
          entry.running = true;
          entry.openedAt = now();
          const gap = lastClosedAt === undefined ? "" : ` (${entry.openedAt - lastClosedAt} ms after the previous dialog closed)`;
          log(`cmdAbl [dialog] info: open: ${name}${gap}`);
          try {
            const value = await task();
            const openFor = now() - entry.openedAt;
            if (settled) {
              log(`cmdAbl [dialog] info: closed after a reset: ${name} (${openFor} ms; result dropped)`);
              return;
            }
            settled = true;
            const answered = typeof value === "string" ? value !== "" : value !== null && value !== undefined;
            log(`cmdAbl [dialog] info: closed: ${name} (${answered ? "returned a value" : "no value"}, open for ${openFor} ms)`);
            finish(entry);
            resolve(value);
          } catch (e: unknown) {
            const openFor = now() - entry.openedAt;
            const reason = e instanceof Error ? e.message : String(e);
            if (settled) {
              log(`cmdAbl [dialog] warn: failed after a reset: ${name} (${reason}; dropped)`);
              return;
            }
            settled = true;
            log(`cmdAbl [dialog] warn: failed: ${name} (${reason}, open for ${openFor} ms)`);
            finish(entry);
            reject(e);
          }
        });
        tail = step.then(
          () => undefined,
          () => undefined,
        );
      });
    },

    describe,

    onIdle(listener) {
      idleListeners.push(listener);
    },

    reset() {
      if (entries.length === 0) return null;
      const running = entries.find((e) => e.running);
      const description = describe();
      const openForMs = running ? now() - running.openedAt : 0;
      log(`cmdAbl [dialog] warn: queue reset (was: ${description}, open for ${Math.round(openForMs / 1000)} s)`);
      const abandoned = entries;
      entries = [];
      lastClosedAt = undefined; // the gap to the next dialog would count from before the hang
      tail = Promise.resolve(); // the next dialog does not wait for the stuck one
      for (const entry of abandoned) entry.abandon();
      notifyIdle();
      return { name: running?.name ?? description ?? "", openForMs };
    },
  };
}
