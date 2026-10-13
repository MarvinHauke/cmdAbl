import type { ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import { quoteIfNeeded } from "./tokenize.js";

// A picked Live-object row in the palette is not a separate action: it becomes
// the command line `goto <unique path>` and runs through `runLine` like a typed
// line — history, presenter, `requires` and the name check come with it.

/** The command an object row stands for (the bundled `goto` module). */
export const OBJECT_ROW_COMMAND = "goto";

/**
 * The line for an object row. The object is looked up in the CURRENT Set by
 * its handle id and addressed by its unique path (`#1` for the first of
 * same-named siblings), the canonical form `runLine` remembers. If the handle
 * is gone the row's path text is used as typed — it then resolves by name or
 * fails as not found; the route is never used to select "whatever sits there
 * now". Null when the row has neither.
 */
export function objectRowLine(
  row: { id: string; kind?: string; path?: string },
  nodes: ObjectNode[],
): string | null {
  const live = nodes.find((n) => n.handleId === row.id && (row.kind === undefined || n.kind === row.kind));
  const address = live ? uniquePath(nodes, live) : row.path;
  if (!address) return null;
  return `${OBJECT_ROW_COMMAND} ${quoteIfNeeded(address)}`;
}
