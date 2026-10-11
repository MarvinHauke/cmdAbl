// The result list `find` leaves behind for `next`/`prev` — pure, so the
// stepping logic is testable without Live. Entries are unambiguous paths,
// re-resolved against the live Set each time one is visited.

export class MatchList {
  private paths: string[] = [];
  private index = -1;

  /** Replace the list; `current` is the entry already visited (or -1 for none yet). */
  set(paths: string[], current = -1): void {
    this.paths = [...paths];
    this.index = current >= 0 && current < paths.length ? current : -1;
  }

  get size(): number {
    return this.paths.length;
  }

  /** Move forward (+1) or back (-1), wrapping around; undefined if the list is empty. */
  step(delta: 1 | -1): { path: string; position: number } | undefined {
    const n = this.paths.length;
    if (n === 0) return undefined;
    this.index = this.index === -1 ? (delta === 1 ? 0 : n - 1) : (this.index + delta + n) % n;
    return { path: this.paths[this.index]!, position: this.index + 1 };
  }
}
