// Tells modules when the Live Set they work on is (re)available or has changed (`api.onSetChange`):
// the Set's id (plan 0013) is read now and then, and a listener hears the id once the Remote Script
// answers for the first time and again whenever it differs. Pure and injectable; nothing throws.

export type SetId = string | null;

export interface SetWatchDeps {
  /** Read the Set's id: `{ ok: true, id }` (null = this Set has none yet), or `{ ok: false }` when the script does not answer. */
  read: () => Promise<{ ok: true; id: SetId } | { ok: false }>;
  /** Milliseconds between two reads while the script answers (default 3000) and while it does not (default 10000). */
  everyMs?: number;
  everyDownMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SetWatch {
  /**
   * Listen: called with the Set's id once it is known (at once, asynchronously, if it already is) and again
   * whenever it changes. A listener that throws is skipped. The first listener starts the polling.
   */
  onChange(listener: (setId: SetId) => void): void;
  /** Read now (e.g. when the palette opens). Resolves when the listeners have been told. */
  check(): Promise<void>;
  /** The id as last read, or undefined before the script answered. */
  current(): SetId | undefined;
  /** Stop polling (tests, shutdown). */
  stop(): void;
}

export function createSetWatch(deps: SetWatchDeps): SetWatch {
  const listeners: Array<(setId: SetId) => void> = [];
  const every = deps.everyMs ?? 3000;
  const everyDown = deps.everyDownMs ?? 10000;
  const setTimer =
    deps.setTimer ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      (t as { unref?: () => void }).unref?.();
      return t;
    });
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let seen: SetId | undefined;
  let timer: unknown;
  let started = false;
  let stopped = false;
  let reading: Promise<void> | null = null;

  const tell = (listener: (setId: SetId) => void, id: SetId): void => {
    try {
      listener(id);
    } catch {
      // one broken listener must not stop the others
    }
  };

  let up = false;

  async function readOnce(): Promise<boolean> {
    let answer: { ok: true; id: SetId } | { ok: false };
    try {
      answer = await deps.read();
    } catch {
      answer = { ok: false };
    }
    if (!answer.ok) return false;
    if (seen === undefined || seen !== answer.id) {
      seen = answer.id;
      for (const listener of [...listeners]) tell(listener, answer.id);
    }
    return true;
  }

  function check(): Promise<void> {
    reading ??= readOnce().then((answered) => void (up = answered)).catch(() => void (up = false)).finally(() => {
      reading = null;
    });
    return reading;
  }

  function schedule(ms: number): void {
    if (stopped) return;
    timer = setTimer(() => {
      // Through check(): only one read is ever in flight, also when a check() from outside lands in the same moment.
      void check().then(() => schedule(up ? every : everyDown));
    }, ms);
  }

  return {
    onChange(listener) {
      listeners.push(listener);
      if (seen !== undefined) {
        const id = seen;
        void Promise.resolve().then(() => tell(listener, id));
      }
      if (!started) {
        started = true;
        void check(); // the first read now, then the polling
        schedule(every);
      }
    },
    check,
    current: () => seen,
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimer(timer);
    },
  };
}
