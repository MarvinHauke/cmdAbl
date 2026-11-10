import type { NotifyAnswer, SelectCreated } from "./ui.js";

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

/**
 * The message page's raw answer, checked against the request it came from: `action` only when it points at a row of the
 * request that has an action (the page never says what an action does), `toggle` only when the request had a checkbox,
 * `open` only when it had a link. Anything else, or unreadable, is null.
 */
export function parseNotifyAnswer(
  raw: string | null | undefined,
  request: { link?: unknown; toggle?: unknown; sections?: Array<{ items: Array<string | { action?: unknown }> }> },
): NotifyAnswer | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: NotifyAnswer = {};
  if (Array.isArray(v.action) && v.action.length === 2) {
    const [s, i] = v.action as unknown[];
    if (Number.isInteger(s) && Number.isInteger(i)) {
      const item = request.sections?.[s as number]?.items[i as number];
      if (item !== undefined && typeof item !== "string" && item.action) out.action = [s as number, i as number];
    }
  }
  if (typeof v.toggle === "boolean" && request.toggle !== undefined) out.toggle = v.toggle;
  if (v.open === true && request.link !== undefined) out.open = true;
  return out.action || out.toggle !== undefined || out.open ? out : null;
}
