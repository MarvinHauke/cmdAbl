export const MAX_ENTRIES = 20;
export const MAX_REMOVED = 20;

interface Entry {
  text: string;
  /** What the user typed when a default command replaced a bare word ("mute" for text "mute #drums"); absent otherwise. */
  typed?: string;
  /** Order of recording: a higher number is newer. A re-run gets a new one. */
  seq: number;
}

/**
 * The history and the stack of entries removed from it (`history clear`,
 * `history forget`), both in memory. Pure logic, no platform port.
 *
 * `entries` is newest first. `removed` is the stack: the most recently removed
 * batch first, and inside a batch the original order (newest first).
 */
export class HistoryStore {
  private entries: Entry[] = [];
  private removed: Array<{ entry: Entry; batch: number }> = [];
  private seq = 0;
  private batch = 0;

  /** The invocations, most recent first. */
  list(): string[] {
    return this.entries.map((e) => e.text);
  }

  /** Like `list`, with what was typed where it differs from what ran. */
  listTyped(): Array<{ text: string; typed?: string }> {
    return this.entries.map((e) => (e.typed === undefined ? { text: e.text } : { text: e.text, typed: e.typed }));
  }

  get size(): number {
    return this.entries.length;
  }

  get removedSize(): number {
    return this.removed.length;
  }

  /** `typed` is kept only when it differs from `text`; a re-run replaces the entry, so the newest `typed` wins. */
  record(text: string, typed?: string): void {
    this.entries = this.entries.filter((e) => e.text !== text);
    const entry: Entry = { text, seq: ++this.seq };
    if (typed !== undefined && typed !== text) entry.typed = typed;
    this.entries.unshift(entry);
    this.entries.length = Math.min(this.entries.length, MAX_ENTRIES);
  }

  /** Move the newest `count` entries (all by default) to the removed stack; returns how many. */
  forget(count = this.entries.length): number {
    const taken = this.entries.splice(0, Math.max(0, count));
    if (taken.length === 0) return 0;
    const batch = ++this.batch;
    this.removed = [...taken.map((entry) => ({ entry, batch })), ...this.removed].slice(0, MAX_REMOVED);
    return taken.length;
  }

  /** Empty the history and the removed stack for good; returns how many history entries went. */
  wipe(): number {
    const n = this.entries.length;
    this.entries = [];
    this.removed = [];
    return n;
  }

  /**
   * Put removed entries back, most recently removed first: `count` of them, or
   * the whole last batch. Entries already in the history again (same text) are
   * dropped; the rest return at their original place by age and the cap still
   * holds (entries the cap pushes out are gone, not put back on the stack). Returns how many are back in the history.
   */
  restore(count?: number): number {
    if (this.removed.length === 0) return 0;
    const n = count ?? this.removed.filter((r) => r.batch === this.removed[0]!.batch).length;
    const taken = this.removed.splice(0, Math.max(0, n));
    const present = new Set(this.entries.map((e) => e.text));
    const back = taken.map((r) => r.entry).filter((e) => !present.has(e.text));
    const merged = [...this.entries, ...back].sort((a, b) => b.seq - a.seq).slice(0, MAX_ENTRIES);
    this.entries = merged;
    return back.filter((e) => merged.includes(e)).length;
  }
}
