import Fuse from "fuse.js";

// The one name matcher of the dialogs and of `find` (path resolution stays
// strict and separate: src/ableton/resolvePath.ts). Two levels:
//
//   matches(text, query)      every typed word occurs in the text, any order,
//                             ignoring case — the filter ("vermona kick" finds
//                             "/Vermona MIDI/Drum Rack/Kick")
//   rank / ranker             fuzzy ranking, best first — the palette's order
//   filterRanked / filterer   the filter, ordered by the fuzzy rank
//   (ranker and filterer build their index once, for use per keystroke)
//
// This file is bundled into the dialog pages at build time (build.ts exposes it
// there as the `CmdMatch` global): pure, no host or Node APIs.

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
