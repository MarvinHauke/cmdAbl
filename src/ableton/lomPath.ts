import type { TrackScope } from "../types.js";

// The canonical Live Object Model path of an object-tree node, built from its
// scope and route only (pure: no SDK, no bridge). The route alternates track
// index, device index, chain index, device index, ... exactly as the Remote
// Script walks it (remote-script/cmdAbl/routes.py), and indices are the LOM's
// own: 0-based, in `tracks` / `return_tracks` order, the main track alone.
// Reference: https://docs.cycling74.com/apiref/lom/ (one page per object).

/** The part of a tree node this needs (an ObjectNode fits). */
export interface LomAddress {
  scope: TrackScope;
  route: number[];
}

const ROOTS: Record<TrackScope, (index: number) => string> = {
  regular: (i) => `live_set tracks ${i}`,
  return: (i) => `live_set return_tracks ${i}`,
  // The main track is a single object: its route is [0], the LOM path has no index.
  master: () => "live_set master_track",
};

/** `live_set tracks 4`, `live_set return_tracks 1`, `live_set master_track`, `… devices 0`, `… devices 0 chains 2`, nested as the route allows. Never throws. */
export function lomPath(node: LomAddress): string {
  const route = Array.isArray(node.route) ? node.route : [];
  if (route.length === 0) return "live_set";
  const root = ROOTS[node.scope] ?? ROOTS.regular;
  let path = root(route[0]!);
  for (let depth = 1; depth < route.length; depth++) {
    path += ` ${depth % 2 === 1 ? "devices" : "chains"} ${route[depth]}`;
  }
  return path;
}

/** The LOM class page slug of a node (https://docs.cycling74.com/apiref/lom/<slug>/). */
export type LomPage = "track" | "device" | "rackdevice" | "chain";

/**
 * Which LOM page describes the node: `track`, `chain` (a Drum Rack's chain is a `drumchain`,
 * which the tree cannot tell: the page `drumchain` adds `in_note`/`out_note`/`choke_group`),
 * `rackdevice` for a device with chain nodes, else `device`. A rack whose chain names are not
 * cached has no chain nodes and is reported as `device`.
 */
export function lomPage(node: { kind: "track" | "device" | "chain"; children?: unknown[] }): LomPage {
  if (node.kind === "track") return "track";
  if (node.kind === "chain") return "chain";
  return (node.children?.length ?? 0) > 0 ? "rackdevice" : "device";
}

export function lomReferenceUrl(page: string): string {
  return `https://docs.cycling74.com/apiref/lom/${page}/`;
}
