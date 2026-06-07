import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem } from "../types.js";
import { buildObjectTree, flattenObjectTree } from "./objectTree.js";

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
  return flattenObjectTree(roots).map((node) => ({
    id: node.handleId,
    type: node.kind,
    action: "select",
    title: node.name,
    subtitle: node.path,
    keywords: [node.name],
    path: node.path,
    route: node.route,
    scope: node.scope,
  }));
}
