import type { ObjectNode } from "../../ableton/objectTree.js";

// The listing `tree` prints: pure, so the depth cut, the start node, the
// counts and the line limit are testable without Live.

/** More lines than this are cut, with a hint to narrow the listing. */
export const MAX_LINES = 200;

/** What the node is, in words a Live user knows. */
export function kindLabel(node: ObjectNode): string {
  if (node.kind === "chain") return "chain";
  if (node.kind === "device") return node.children.some((c) => c.kind === "chain") ? "rack" : "device";
  if (node.scope === "return") return "return track";
  if (node.scope === "master") return "main track";
  return node.children.some((c) => c.kind === "track") ? "group track" : "track";
}

export interface RenderOptions {
  /** Where the listing starts; undefined = the whole Set. */
  start?: ObjectNode;
  /** How many levels below the start are shown. */
  depth: number;
  maxLines?: number;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The top of the object tree: nodes that are nobody's child. */
export function rootsOf(nodes: ObjectNode[]): ObjectNode[] {
  const children = new Set<ObjectNode>();
  for (const n of nodes) for (const c of n.children) children.add(c);
  return nodes.filter((n) => !children.has(n));
}

/**
 * Indented list, two spaces per level, `name  (kind)`; a last line with the
 * counts of the objects LISTED below the header (the start itself is the
 * header and is not counted). Cut at `maxLines` with a hint; the counts then
 * cover only what is shown.
 */
export function renderTree(nodes: ObjectNode[], options: RenderOptions): string {
  const maxLines = options.maxLines ?? MAX_LINES;
  const entries: Array<{ line: string; kind: ObjectNode["kind"] }> = [];
  const walk = (node: ObjectNode, level: number): void => {
    entries.push({ line: `${"  ".repeat(level)}${node.name}  (${kindLabel(node)})`, kind: node.kind });
    if (level >= options.depth) return;
    for (const child of node.children) walk(child, level + 1);
  };

  let header: string;
  if (options.start) {
    header = options.start.path;
    if (options.depth >= 1) for (const child of options.start.children) walk(child, 1);
  } else {
    header = "Live Set";
    for (const root of rootsOf(nodes)) walk(root, 1);
  }

  const total = entries.length;
  const shown = entries.slice(0, maxLines);
  const counts = { track: 0, device: 0, chain: 0 };
  for (const e of shown) counts[e.kind]++;
  const summary = `${plural(counts.track, "track")}, ${plural(counts.device, "device")}, ${plural(counts.chain, "chain")}`;

  const body = shown.map((e) => e.line);
  if (total === 0) body.push("  (nothing below)");
  if (total > maxLines) body.push(`… cut after ${maxLines} of ${total} lines; pass a path or a smaller -L to see less`);
  return [header, ...body, summary].join("\n");
}
