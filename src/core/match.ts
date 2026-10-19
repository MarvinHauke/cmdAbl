import Fuse from "fuse.js";

// The one name matcher of the dialogs and of `find` (path resolution stays
// strict and separate: src/ableton/resolvePath.ts). Two levels:
//
//   matches(text, query)      every typed word occurs in the text, any order,
//                             ignoring case — the filter ("808 snare" finds
//                             "/2-808 Core Kit/808 Core Kit/Snare Drum")
//   rank / ranker             fuzzy ranking, best first — the palette's order
//   filterRanked / filterer   the filter, ordered by the fuzzy rank
//   (ranker and filterer build their index once, for use per keystroke)
//
// This file is bundled into the dialog pages at build time (build.ts exposes it
// there as the `CmdMatch` global): pure, no host or Node APIs. Not everything
// here is for the pages — `suggest` is used by the platform's resolver only.

/** The palette's fuzzy options. Changing them changes the palette's order. */
export const FUZZY_OPTIONS = { threshold: 0.4, ignoreLocation: true } as const;

/** The words of a query, lowercased. */
export function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word of `query` occurs in `text`, in any order, ignoring case. An empty query matches nothing. */
export function matches(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  const needles = words(query);
  return needles.length > 0 && needles.every((word) => haystack.includes(word));
}

/** The part of a typed word that names an object itself: after the last "/", without a trailing "#n". */
function ownPart(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1).replace(/#\d+$/, "");
}

/**
 * Text matching for an object of the Live Set (the "own name" rule): every typed
 * word occurs in the object's path, and at least one of them occurs in the
 * object's OWN name (`name`, the last path segment without its ordinal). A word
 * that only names a parent therefore never pulls in everything below that
 * parent: `lead` finds the track Lead, not its devices and chains;
 * `lead utility` finds the device called Utility below it.
 */
export function matchesNode(node: { path: string; name: string }, query: string): boolean {
  if (!matches(node.path, query)) return false;
  const own = node.name.toLowerCase();
  return words(query).some((word) => {
    const part = ownPart(word);
    return part !== "" && own.includes(part);
  });
}

/**
 * Fuzzy ranking over `keys`, prepared once (the index is built here, not per
 * keystroke): returns a function from query to the items whose fuzzy score
 * passes the palette's threshold, best first (Fuse.js, exactly the palette's
 * former search). An empty query returns the items unchanged. Fuse takes a
 * query as ONE pattern, so a multi-word query is scored as a whole.
 */
export function ranker<T>(items: readonly T[], keys: string[]): (query: string) => T[] {
  const all = [...items];
  const fuse = new Fuse(all, { ...FUZZY_OPTIONS, keys });
  return (query) => {
    const q = query.trim();
    return q ? fuse.search(q).map((r) => r.item) : [...all];
  };
}

/** `ranker` for one-off use. */
export function rank<T>(items: readonly T[], query: string, keys: string[]): T[] {
  return ranker(items, keys)(query);
}

/**
 * The pick list's filter, prepared once: returns a function from query to the
 * items whose text contains every typed word (`matches`), the better fuzzy hits
 * first. Items the fuzzy search does not score (most multi-word queries, which
 * Fuse reads as one pattern) keep their given order after those, so the
 * ranking mainly helps one-word queries. An empty query returns everything —
 * unlike `matches`, where "nothing typed finds nothing" is what `find` needs:
 * a list filter with no input shows the whole list.
 */
export function filterer<T>(items: readonly T[], textOf: (item: T) => string): (query: string) => T[] {
  const all = [...items];
  const fuse = new Fuse(
    all.map((_, index) => ({ index, text: textOf(all[index]!) })),
    { ...FUZZY_OPTIONS, keys: ["text"] },
  );
  return (query) => {
    const q = query.trim();
    if (!q) return [...all];
    const position = new Map<number, number>();
    fuse.search(q).forEach((hit, order) => position.set(hit.item.index, order));
    return all
      .map((item, index) => ({ item, index, order: position.get(index) ?? Number.MAX_SAFE_INTEGER }))
      .filter((entry) => matches(textOf(entry.item), q))
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map((entry) => entry.item);
  };
}

/** `filterer` for one-off use. */
export function filterRanked<T>(items: readonly T[], query: string, textOf: (item: T) => string): T[] {
  return filterer(items, textOf)(query);
}

/** Most suggestions offered for one text. */
export const MAX_SUGGESTIONS = 8;
/**
 * How loose a "did you mean" may be. It decides whether to interrupt the user
 * with a list, so it is its own constant, not the palette's ranking threshold
 * (equal today; tighten it here if lists show up for plain nonsense).
 */
export const SUGGEST_THRESHOLD = 0.4;
/** Shorter words are too weak to suggest anything from ("zz" would fit everything). */
export const MIN_SUGGEST_WORD = 3;

/**
 * "Did you mean": items that fuzzily fit EVERY word of `query` (typos, a
 * missing letter), best first, at most `limit`. Fuse scores each word on its
 * own (the palette's threshold); an item's rank is the sum of its per-word
 * ranks. Empty when the query is empty or a word is too short to mean anything.
 */
export function suggest<T>(
  items: readonly T[],
  query: string,
  keys: string[],
  limit = MAX_SUGGESTIONS,
  /** When given, at least one word must also fit this field fuzzily (an object's own name). */
  ownKey?: string,
): T[] {
  const needles = words(query);
  if (needles.length === 0 || needles.some((w) => w.length < MIN_SUGGEST_WORD)) return [];
  const all = [...items];
  const fuse = new Fuse(
    all.map((_, index) => ({ index, ...Object.fromEntries(keys.map((k) => [k, String((all[index] as Record<string, unknown>)[k] ?? "")])) })),
    { ...FUZZY_OPTIONS, threshold: SUGGEST_THRESHOLD, keys },
  );
  const totals = new Map<number, number>();
  needles.forEach((word, round) => {
    const seen = new Map<number, number>();
    fuse.search(word).forEach((hit, order) => seen.set(hit.item.index, order));
    if (round === 0) for (const [index, order] of seen) totals.set(index, order);
    else {
      for (const index of [...totals.keys()]) {
        const order = seen.get(index);
        if (order === undefined) totals.delete(index);
        else totals.set(index, totals.get(index)! + order);
      }
    }
  });
  if (ownKey) {
    const own = new Fuse(
      all.map((_, index) => ({ index, [ownKey]: String((all[index] as Record<string, unknown>)[ownKey] ?? "") })),
      { ...FUZZY_OPTIONS, threshold: SUGGEST_THRESHOLD, keys: [ownKey] },
    );
    const ownFit = new Set<number>();
    for (const word of needles) for (const hit of own.search(ownPart(word) || word)) ownFit.add(hit.item.index);
    for (const index of [...totals.keys()]) if (!ownFit.has(index)) totals.delete(index);
  }
  return [...totals.entries()]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([index]) => all[index]!);
}
