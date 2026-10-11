// One dialog at a time. The SDK's showModalDialog is not known to cope with a
// second call while a modal is open (the promise may never settle), so every
// dialog of the default UI goes through this queue: a dialog is opened only
// after the previous one closed. Pure — the log sink is injected — so it is
// testable without Live.

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
}

interface Entry {
  name: string;
  running: boolean;
}

export function createDialogQueue(log: (line: string) => void = (line) => console.log(line)): DialogQueue {
  const entries: Entry[] = [];
  const idleListeners: Array<() => void> = [];
  let tail: Promise<unknown> = Promise.resolve();

  function finish(entry: Entry): void {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (entries.length > 0) return;
    for (const listener of idleListeners) {
      try {
        listener();
      } catch (e: unknown) {
        log(`cmdAbl: dialog idle listener failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    run<T>(name: string, task: () => Promise<T>): Promise<T> {
      const entry: Entry = { name, running: false };
      entries.push(entry);
      const result = tail.then(async () => {
        entry.running = true;
        log(`cmdAbl: dialog open: ${name}`);
        try {
          const value = await task();
          const answered = typeof value === "string" ? value !== "" : value !== null && value !== undefined;
          log(`cmdAbl: dialog closed: ${name} (${answered ? "returned a value" : "no value"})`);
          return value;
        } catch (e: unknown) {
          log(`cmdAbl: dialog failed: ${name} (${e instanceof Error ? e.message : String(e)})`);
          throw e;
        } finally {
          finish(entry);
        }
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    describe() {
      if (entries.length === 0) return null;
      if (entries.length === 1) return entries[0]!.name;
      return entries.map((e) => `${e.name} (${e.running ? "open" : "queued"})`).join(", ");
    },

    onIdle(listener) {
      idleListeners.push(listener);
    },
  };
}
