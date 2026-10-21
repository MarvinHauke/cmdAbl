// The tree is read through the module API (`api.commands.roots()` / `help()`); only the
// fields the page needs are named here.
interface Node {
  name: string;
  aliases?: string[];
  requires?: string[];
  destructive?: boolean;
  children?: readonly Node[];
}

// The pure part of `man <command>`: finding a node by words, rendering its page
// from the tree (the text `--help` prints, plus the facts the generated
// reference states), the web address of its section and near misses for a
// mistyped name. No Live, no platform.

export const REFERENCE_URL = "https://marvinhauke.github.io/cmdAbl/reference/commands/";

export interface Found {
  node: Node;
  path: string[];
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The node a list of words names (a command name or alias at each level), or undefined. */
export function findNode(roots: readonly Node[], words: string[]): Found | undefined {
  if (words.length === 0) return undefined;
  let level: readonly Node[] = roots;
  let node: Node | undefined;
  const path: string[] = [];
  for (const word of words) {
    node = level.find((n) => same(n.name, word) || (n.aliases ?? []).some((a) => same(a, word)));
    if (!node) return undefined;
    path.push(node.name);
    level = node.children ?? [];
  }
  return { node: node!, path };
}

/**
 * The anchor of a command's section in the generated reference: MkDocs slugs
 * the heading `` `history clear` `` the way docs/reference/commands.md has it.
 */
export function anchorOf(path: string[]): string {
  return path
    .join(" ")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export const webUrl = (path: string[]): string => `${REFERENCE_URL}#${anchorOf(path)}`;

/** The page: the `--help` text, the facts the reference adds, and the section's web address. */
export function manPage(help: string, node: Node, path: string[]): string {
  const lines = [help];
  const facts: string[] = [];
  if (node.aliases?.length) facts.push(`aliases: ${node.aliases.join(", ")}`);
  if (node.requires?.includes("bridge")) facts.push("needs the Remote Script (otherwise: not running)");
  if (node.destructive) facts.push("removes or irreversibly changes something; takes one target per address, never every match");
  if (facts.length) lines.push("", ...facts.map((f) => `note: ${f}`));
  lines.push("", `web: ${webUrl(path)}`);
  return lines.join("\n");
}

/** Every command path in the tree, depth first. */
export function allPaths(roots: readonly Node[]): string[][] {
  const out: string[][] = [];
  const walk = (node: Node, path: string[]): void => {
    out.push(path);
    for (const child of node.children ?? []) walk(child, [...path, child.name]);
  };
  for (const root of roots) walk(root, [root.name]);
  return out;
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Command paths near what was typed: same start, containing it, or a word within two typos. Best first, at most `limit`. */
export function closeMatches(roots: readonly Node[], words: string[], limit = 5): string[] {
  const typed = words.join(" ").toLowerCase();
  const scored: Array<{ text: string; score: number }> = [];
  for (const path of allPaths(roots)) {
    const text = path.join(" ");
    const lower = text.toLowerCase();
    let score: number | undefined;
    if (lower.startsWith(typed)) score = 0;
    else if (lower.includes(typed)) score = 1;
    else {
      const d = Math.min(distance(typed, lower), distance(words[0]!.toLowerCase(), path[0]!.toLowerCase()) + (path.length - 1));
      if (d <= 2) score = 2 + d;
    }
    if (score !== undefined) scored.push({ text, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.text.length - b.text.length).slice(0, limit).map((s) => s.text);
}
