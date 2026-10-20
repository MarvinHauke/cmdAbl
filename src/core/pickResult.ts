import type { SelectCreated } from "./ui.js";

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

/**
 * A select surface's answer: row indexes (confirmed), `{ fill: index }` (Tab on
 * a single-select list that allows it: put the row into the prompt instead of
 * running), or null (cancelled / unreadable).
 */
export function parseSelectAnswer(raw: string | null | undefined, count: number): number[] | { fill: number } | SelectCreated | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const created = (value as { created?: unknown }).created;
      if (typeof created === "string") {
        const text = created.trim();
        const picked = (value as { picked?: unknown }).picked;
        const indexes = Array.isArray(picked) ? parseIndexes(JSON.stringify(picked), count) : null;
        return text ? { created: text, picked: indexes ?? [] } : null;
      }
      const fill = (value as { fill?: unknown }).fill;
      return Number.isInteger(fill) && (fill as number) >= 0 && (fill as number) < count ? { fill: fill as number } : null;
    }
  } catch {
    return null;
  }
  return parseIndexes(raw, count);
}

/** The message page's answer when its link button was clicked. */
export function wantsOpen(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { open?: unknown } | null)?.open === true;
  } catch {
    return false;
  }
}
