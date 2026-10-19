import type { ObjectNode } from "../../ableton/objectTree.js";
import { matches, matchesNode } from "../../core/match.js";
import type { PaletteItemType } from "../../core/types.js";

// Which objects `find` lists. Pure: the pattern, the level and the kinds in,
// the nodes out — so each case is testable without Live.

export interface FindQuery {
  /** The words; empty or undefined = no pattern. */
  pattern?: string;
  /**
   * With a pattern: how far BELOW an object whose own name matches the
   * results go (0 = only those objects). Without a pattern: how many levels
   * below the Set are listed (1 = tracks, 2 = tracks and their devices).
   * Undefined = no limit: everything whose path contains the words.
   */
  level?: number;
  kinds: PaletteItemType[];
}

/** The nodes' parent relation, from the children lists of the flattened tree. */
function parentsOf(nodes: ObjectNode[]): Map<ObjectNode, ObjectNode> {
  const parents = new Map<ObjectNode, ObjectNode>();
  for (const node of nodes) for (const child of node.children) parents.set(child, node);
  return parents;
}

/**
 * - pattern, no level: every node whose path contains every word (a search).
 * - pattern and level n: a node is listed if it, or an ancestor at most n
 *   levels above it, is an "own-name" match (`matchesNode`: every word in the
 *   path, at least one in the node's own name). A descendant's path extends
 *   its ancestor's, so it satisfies the path rule too.
 * - no pattern: the level limits the depth from the top of the Set.
 * The `kinds` filter applies to the results only, never to the anchors.
 */
export function findNodes(nodes: ObjectNode[], query: FindQuery): ObjectNode[] {
  const pattern = (query.pattern ?? "").trim();
  const parents = parentsOf(nodes);
  const inKinds = (n: ObjectNode) => query.kinds.includes(n.kind);

  if (pattern === "") {
    const depthOf = (node: ObjectNode): number => {
      let depth = 1;
      for (let p = parents.get(node); p; p = parents.get(p)) depth++;
      return depth;
    };
    return nodes.filter((n) => inKinds(n) && (query.level === undefined || depthOf(n) <= query.level));
  }

  if (query.level === undefined) return nodes.filter((n) => inKinds(n) && matches(n.path, pattern));

  const anchors = new Map<ObjectNode, boolean>();
  const isAnchor = (n: ObjectNode): boolean => {
    let v = anchors.get(n);
    if (v === undefined) {
      v = matchesNode(n, pattern);
      anchors.set(n, v);
    }
    return v;
  };
  return nodes.filter((n) => {
    if (!inKinds(n)) return false;
    let node: ObjectNode | undefined = n;
    for (let up = 0; node && up <= query.level!; up++, node = parents.get(node)) {
      if (isAnchor(node)) return true;
    }
    return false;
  });
}
