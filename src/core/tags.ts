import type { NodeKind, ObjectNode } from "../ableton/objectTree.js";

// Tags on objects (plan 0008): `#fx` as a target means every object tagged `fx`,
// a bare `#` opens a list of the Set's tags. The tags live on the nodes
// (`ObjectNode.tags`, filled by the bridge's background cache); this file only
// reads them. Pure.

/** The tags of a node (empty when it has none or they are not known). */
export function tagsOf(node: ObjectNode): string[] {
  const tags = (node as { tags?: unknown }).tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase()) : [];
}

/** `#fx` (a tag name: letters, digits, `-`, `_`) or the bare `#`; anything else is no tag target. */
const TAG_TARGET = /^(!?)#([A-Za-z0-9_-]*)$/;

/**
 * What a typed target means as a tag: `"list"` for a bare `#`, `{ name }` (lower-case)
 * for `#fx`, `{ name, negate: true }` for `!#fx` (every track WITHOUT the tag), null for any other text
 * (a bare `!#` is none).
 */
export function parseTagTarget(text: string): "list" | { name: string; negate?: true } | null {
  const match = TAG_TARGET.exec(text.trim());
  if (!match) return null;
  if (match[2] === "") return match[1] === "" ? "list" : null;
  const name = match[2]!.toLowerCase();
  return match[1] === "!" ? { name, negate: true } : { name };
}

/**
 * The objects a tag target stands for: those tagged `name`, or for a negation the
 * tracks without it (untagged included) — regular tracks only: never the main
 * track, return tracks only when typed by path.
 */
export function nodesForTag(nodes: ObjectNode[], tag: { name: string; negate?: true }, kinds?: NodeKind[]): ObjectNode[] {
  if (!tag.negate) return nodesWithTag(nodes, tag.name, kinds);
  const wanted = tag.name.toLowerCase();
  return nodes.filter(
    (n) => n.kind === "track" && n.scope === "regular" && (!kinds || kinds.includes("track")) && !tagsOf(n).includes(wanted),
  );
}

/** Whether a (bare) word could be a tag name; such a word also finds the objects tagged with it. */
export function isTagWord(text: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(text);
}

/** Every node tagged `name`, restricted to `kinds`, in tree order. */
export function nodesWithTag(nodes: ObjectNode[], name: string, kinds?: NodeKind[]): ObjectNode[] {
  const wanted = name.toLowerCase();
  return nodes.filter((n) => (!kinds || kinds.includes(n.kind)) && tagsOf(n).includes(wanted));
}

export interface TagCount {
  name: string;
  count: number;
}

/** The Set's tags with how many (kind-matching) objects carry each, sorted by name. */
export function tagCounts(nodes: ObjectNode[], kinds?: NodeKind[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (kinds && !kinds.includes(n.kind)) continue;
    for (const tag of new Set(tagsOf(n))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/** ` #fx #synth` for a pick row's detail, or "". */
export function tagSuffix(node: ObjectNode): string {
  const tags = tagsOf(node);
  return tags.length ? ` ${tags.map((t) => `#${t}`).join(" ")}` : "";
}
