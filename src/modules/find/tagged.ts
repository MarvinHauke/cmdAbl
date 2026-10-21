import type { ObjectNode } from "../../ableton/objectTree.js";
import { matches } from "../../core/match.js";
import { parseTagTarget } from "../../core/tags.js";
import type { PaletteItemType } from "../../core/types.js";
import { findNodes } from "./select.js";

// find and tags (plan 0008). `#drums` in the pattern restricts the search to
// the tracks tagged drums (and what sits in them), `!#drums` to the regular
// tracks without it; a plain word that is a tag name also finds the tracks
// carrying that tag. Pure: the tags come in as a function.

export interface TagFilter {
  name: string;
  negate: boolean;
}

/** The pattern's words, split into tag filters (`#fx`, `!#fx`) and plain words. */
export function splitPattern(pattern: string): { plain: string[]; tags: TagFilter[] } {
  const plain: string[] = [];
  const tags: TagFilter[] = [];
  for (const word of pattern.split(/\s+/).filter(Boolean)) {
    const tag = parseTagTarget(word); // the one grammar of #fx / !#fx; a bare # is a plain word here
    if (tag && tag !== "list") tags.push({ name: tag.name, negate: tag.negate === true });
    else plain.push(word);
  }
  return { plain, tags };
}

export const describeTags = (tags: TagFilter[]): string =>
  tags.every((t) => !t.negate)
    ? `no track is tagged ${tags.map((t) => `#${t.name}`).join(" ")}`
    : tags.every((t) => t.negate)
      ? `no track without ${tags.map((t) => `#${t.name}`).join(" ")}`
      : `no track matches ${tags.map((t) => `${t.negate ? "!" : ""}#${t.name}`).join(" ")}`;

export interface TaggedQuery {
  plain: string[];
  tags: TagFilter[];
  level?: number;
  kinds: PaletteItemType[];
  /** A kind flag was given: list those kinds inside the tracks instead of the tracks themselves. */
  kindFlag: boolean;
  tagsOf: (node: ObjectNode) => string[];
}

/** Result of a tagged search: the tracks the tags selected, and the hits. */
export function findTagged(nodes: ObjectNode[], query: TaggedQuery): { scope: ObjectNode[]; hits: ObjectNode[] } {
  const has = (n: ObjectNode, tag: string) => query.tagsOf(n).includes(tag);
  // Negation never reaches main/return tracks (like the platform's `!#`).
  const negated = query.tags.some((t) => t.negate);
  const scope = nodes.filter(
    (n) =>
      n.kind === "track" &&
      (!negated || n.scope === "regular") &&
      query.tags.every((t) => (t.negate ? !has(n, t.name) : has(n, t.name))),
  );
  if (scope.length === 0) return { scope, hits: [] };

  const pattern = query.plain.join(" ");
  if (pattern === "" && !query.kindFlag && query.level === undefined) {
    return { scope, hits: query.kinds.includes("track") ? scope : [] };
  }
  const inside = new Set<ObjectNode>();
  const collect = (n: ObjectNode): void => {
    if (inside.has(n)) return;
    inside.add(n);
    for (const child of n.children) collect(child);
  };
  scope.forEach(collect);
  const hits = findNodes(
    nodes.filter((n) => inside.has(n)),
    { pattern, level: query.level, kinds: query.kinds },
  );
  return { scope, hits };
}

/**
 * Without tag words: what `find` found by path, plus the tracks that carry a
 * tag named like a plain word (every word must match the path or be a tag).
 * Tree order.
 */
export function addTagMatches(
  nodes: ObjectNode[],
  found: ObjectNode[],
  plain: string[],
  kinds: PaletteItemType[],
  tagsOf: (node: ObjectNode) => string[],
): ObjectNode[] {
  if (plain.length === 0 || !kinds.includes("track")) return found;
  const keep = new Set(found);
  for (const n of nodes) {
    if (n.kind !== "track") continue;
    const tags = tagsOf(n);
    if (tags.length > 0 && plain.every((w) => matches(n.path, w) || tags.includes(w.toLowerCase()))) keep.add(n);
  }
  return nodes.filter((n) => keep.has(n));
}

/** The tags of the filters that no track carries: asking for tracks without such a tag would list everything. */
export function unknownTags(nodes: ObjectNode[], tags: TagFilter[], tagsOf: (node: ObjectNode) => string[]): TagFilter[] {
  const known = new Set<string>();
  for (const n of nodes) if (n.kind === "track") for (const t of tagsOf(n)) known.add(t);
  return tags.filter((t) => !known.has(t.name));
}
