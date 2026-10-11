import type { NodeKind, ObjectNode } from "./objectTree.js";

// Turns a typed address into the objects it names. Pure (works on a flattened
// tree), so it never silently picks "the first one": callers get every match
// and decide — zero is "not found", more than one is "ambiguous".
//
// Matching, in order — the first rule that yields anything wins:
//   1. Structural: same segments. A segment without an ordinal ("Kick")
//      matches every same-named sibling ("Kick", "Kick#2"); "Kick#2" matches
//      only the second, "Kick#1" only the first.
//   2. The same, ignoring case.
//   3. Substring of the path, ignoring case ("kick" finds "/Drums/Kick").

interface Segment {
  name: string;
  ordinal?: number;
}

function splitPath(path: string): Segment[] {
  return path
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => {
      const m = /^(.*)#(\d+)$/.exec(part);
      return m && m[1] ? { name: m[1], ordinal: Number(m[2]) } : { name: part };
    });
}

function matchesStructurally(node: ObjectNode, query: Segment[], ignoreCase: boolean): boolean {
  const own = splitPath(node.path);
  if (own.length !== query.length) return false;
  return query.every((q, i) => {
    const seg = own[i]!;
    const sameName = ignoreCase ? seg.name.toLowerCase() === q.name.toLowerCase() : seg.name === q.name;
    return sameName && (q.ordinal === undefined || q.ordinal === (seg.ordinal ?? 1));
  });
}

export function resolvePath(nodes: ObjectNode[], query: string, kinds?: NodeKind[]): ObjectNode[] {
  const candidates = kinds ? nodes.filter((n) => kinds.includes(n.kind)) : nodes;
  const trimmed = query.trim();
  if (!trimmed) return [];
  const segments = splitPath(trimmed);

  for (const ignoreCase of [false, true]) {
    const hits = candidates.filter((n) => matchesStructurally(n, segments, ignoreCase));
    if (hits.length) return hits;
  }

  const needle = trimmed.toLowerCase();
  return candidates.filter((n) => n.path.toLowerCase().includes(needle));
}
