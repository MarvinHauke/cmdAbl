import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem } from "../../types.js";
import { buildObjectTree, flattenObjectTree } from "../../ableton/objectTree.js";

// Reading a track/device's name is a synchronous getter, so snapshotting the
// current Set is cheap. We do it once each time the palette opens — the modal
// is short-lived, so the data can't go stale underneath it.
//
// The handle id and route are carried through so the object can be
// re-resolved at execute time (see resolveRef) — handles aren't permanent,
// and re-walking by id (falling back to the recorded route) recovers the
// object's current position after a reorder.

export function snapshotObjectTree(context: ExtensionContext<"1.0.0">): PaletteItem[] {
  const roots = buildObjectTree(context);
  const nodes = flattenObjectTree(roots);

  // Same-named objects are common (multiple "Kick"s, repeated group structures,
  // a dominant container that wraps almost everything), so showing the *full*
  // path as the subtitle on every row is mostly redundant noise rather than a
  // disambiguator — title (the bare name) already carries the identity. Show
  // the full path only where it actually disambiguates (a name collision);
  // otherwise fall back to just the immediate parent's bare name (not a path
  // string — a dominant ancestor several levels up would otherwise still leak
  // into every row), or nothing for root-level objects.
  const nameCounts = new Map<string, number>();
  for (const node of nodes) nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1);

  return nodes.map((node) => {
    const parentPath = node.path.slice(0, -(node.name.length + 1));
    const parentName = parentPath.split("/").filter(Boolean).pop();
    const subtitle = (nameCounts.get(node.name) ?? 0) > 1 ? node.path : parentName;
    return {
      id: node.handleId,
      type: node.kind,
      action: "select",
      title: node.name,
      subtitle,
      keywords: [node.name],
      path: node.path,
      route: node.route,
      scope: node.scope,
    };
  });
}
