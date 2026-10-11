import type { ObjectNode } from "../../ableton/objectTree.js";
import type { PaletteResult } from "../../types.js";

/**
 * The live node a palette row stands for. Handles are not permanent, so the
 * row's handle id is looked up in a fresh tree first; if it is gone, the
 * recorded scope + route is tried (the object's position after a reorder is
 * already reflected in the fresh tree, so a hit there is the same slot).
 */
export function findItemNode(nodes: ObjectNode[], item: PaletteResult): ObjectNode | undefined {
  if (item.type !== "track" && item.type !== "device" && item.type !== "chain") return undefined;
  const byId = nodes.find((n) => n.kind === item.type && n.handleId === item.id);
  if (byId) return byId;
  const route = item.route;
  if (!route) return undefined;
  const scope = item.scope ?? "regular";
  return nodes.find(
    (n) =>
      n.kind === item.type &&
      n.scope === scope &&
      n.route.length === route.length &&
      n.route.every((v, i) => v === route[i]),
  );
}
