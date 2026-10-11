// Kept apart from pick.ts (which imports the HTML template) so it can be unit-tested.

/** The dialog returns a JSON array of candidate indexes, or nothing when cancelled. */
export function parsePickResult<T>(raw: string | null | undefined, candidates: T[]): T[] | null {
  if (!raw) return null;
  try {
    const indexes: unknown = JSON.parse(raw);
    if (!Array.isArray(indexes)) return null;
    const chosen = indexes
      .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .map((i) => candidates[i]!);
    return chosen.length ? chosen : null;
  } catch {
    return null;
  }
}
