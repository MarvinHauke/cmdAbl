// Kept apart from the modules that import HTML templates so it can be unit-tested.

/** A select surface returns a JSON array of row indexes, or nothing when cancelled. */
export function parseIndexes(raw: string | null | undefined, count: number): number[] | null {
  if (!raw) return null;
  try {
    const indexes: unknown = JSON.parse(raw);
    if (!Array.isArray(indexes)) return null;
    const valid = indexes.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < count);
    return valid.length ? valid : null;
  } catch {
    return null;
  }
}

export function parsePickResult<T>(raw: string | null | undefined, candidates: T[]): T[] | null {
  return parseIndexes(raw, candidates.length)?.map((i) => candidates[i]!) ?? null;
}
