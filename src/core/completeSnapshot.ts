import type { ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import { completerKeys, completionTree, type CommandNode } from "./commandTree.js";
import type { Candidate, Completer, CompletionData, PathRow, TagRow } from "./complete.js";
import { tagCounts } from "./tags.js";

// The completion snapshot (plan 0006): taken once when the palette opens, put into the page's JSON,
// and used there by `complete()` while the user types. Host side, so it may call modules' completers
// and read the caches; the page side (complete.ts) only reads the result.

/** What one completer may take; a slower one gives no rows (and a debug line). */
export const COMPLETER_BUDGET_MS = 100;
/** What the refresh of the caches (tags, rack chains) may take before the snapshot uses what it has. */
export const REFRESH_BUDGET_MS = 300;
export const MAX_PATHS = 1000;
export const MAX_TAGS = 200;
/** Rows kept per completer. */
export const MAX_CANDIDATES = 500;
const MAX_TEXT = 200;

export interface SnapshotDeps {
  roots: readonly CommandNode<any, any>[];
  completers: ReadonlyMap<string, Completer>;
  /** The Set's objects, read AFTER `refresh` finished. */
  nodes: () => ObjectNode[];
  /** Refresh the bridge-backed caches (tags, chain names); under `refreshBudgetMs`. Optional. */
  refresh?: () => Promise<unknown>;
  completerBudgetMs?: number;
  refreshBudgetMs?: number;
  /** Debug lines (never a token or secret). */
  debug?: (line: string) => void;
}

/** The answer of `work`, or `fallback` when it throws, rejects or takes over `ms`. Never rejects; the timer is cleared. */
export async function withBudget<T>(work: () => T | Promise<T>, ms: number, fallback: T, onFail?: (why: string) => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), ms);
    });
    const answer = await Promise.race([Promise.resolve().then(work), limit]);
    if (answer === "timeout") {
      onFail?.(`took over ${ms} ms`);
      return fallback;
    }
    return answer;
  } catch (e: unknown) {
    onFail?.(e instanceof Error ? e.message : String(e));
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Plain candidates from whatever a completer returned: strings become `{ label }`; bad entries and extra fields are dropped; capped. */
export function normalizeCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) return [];
  const out: Candidate[] = [];
  const cut = (text: string): string => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);
  for (const entry of raw) {
    if (out.length >= MAX_CANDIDATES) break;
    if (typeof entry === "string") {
      if (entry !== "") out.push({ label: cut(entry) });
      continue;
    }
    if (entry === null || typeof entry !== "object") continue;
    const { label, insert, description } = entry as Record<string, unknown>;
    if (typeof label !== "string" || label === "") continue;
    out.push({
      label: cut(label),
      ...(typeof insert === "string" && insert !== "" && insert !== label ? { insert: cut(insert) } : {}),
      ...(typeof description === "string" && description !== "" ? { description: cut(description) } : {}),
    });
  }
  return out;
}

/**
 * The objects as path rows in tree order, at most `MAX_PATHS`. Over the cap the tracks stay first, then
 * chains and pads, then devices; the kept rows keep their tree order.
 */
export function pathRows(nodes: readonly ObjectNode[], cap = MAX_PATHS): PathRow[] {
  const all = nodes as ObjectNode[];
  let keep = all.map((_, i) => i);
  if (all.length > cap) {
    const rank = { track: 0, chain: 1, device: 2 } as const;
    keep = keep.sort((a, b) => rank[all[a]!.kind] - rank[all[b]!.kind] || a - b).slice(0, cap).sort((a, b) => a - b);
  }
  // `uniquePath` scans every node; only a path that shares its names (ordinals stripped) with another needs it.
  const bare = (path: string): string => path.split("/").map((part) => /^(.+)#\d+$/.exec(part)?.[1] ?? part).join("/");
  const sharing = new Map<string, number>();
  for (const node of all) sharing.set(bare(node.path), (sharing.get(bare(node.path)) ?? 0) + 1);
  return keep.map((i) => {
    const node = all[i]!;
    return { path: sharing.get(bare(node.path)) === 1 ? node.path : uniquePath(all, node), name: node.name, kind: node.kind };
  });
}

/** The Set's tags, sorted by name, at most `MAX_TAGS` (the most used stay when it is over the cap). */
export function tagRows(nodes: readonly ObjectNode[], cap = MAX_TAGS): TagRow[] {
  const counts = tagCounts(nodes as ObjectNode[]);
  if (counts.length <= cap) return counts;
  return counts.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, cap).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the snapshot. Never throws and never waits long: the cache refresh, and every completer, run under a
 * budget; a failure or timeout gives no rows for that source and one debug line.
 */
export async function buildCompletionData(deps: SnapshotDeps): Promise<CompletionData> {
  const debug = deps.debug ?? (() => {});
  const keys = completerKeys(deps.roots);
  const completerMs = deps.completerBudgetMs ?? COMPLETER_BUDGET_MS;

  // The completers and the cache refresh run side by side.
  const rowsFor = Promise.all(
    keys.map(async (key): Promise<[string, Candidate[]]> => {
      const source = deps.completers.get(key);
      if (!source) return [key, []];
      const raw = await withBudget(() => source({}), completerMs, [], (why) => debug(`completer "${key}" gave no rows: ${why}`));
      return [key, normalizeCandidates(raw)];
    }),
  );
  if (deps.refresh) {
    await withBudget(deps.refresh, deps.refreshBudgetMs ?? REFRESH_BUDGET_MS, undefined, (why) => debug(`completion: cache refresh gave up: ${why}`));
  }
  const completions = Object.fromEntries(await rowsFor);

  let nodes: ObjectNode[] = [];
  try {
    nodes = deps.nodes();
  } catch (e: unknown) {
    debug(`completion: cannot read the Set: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (nodes.length > MAX_PATHS) debug(`completion: paths capped (${MAX_PATHS} of ${nodes.length}); devices are dropped first`);
  return {
    tree: completionTree(deps.roots),
    completions,
    paths: pathRows(nodes),
    tags: tagRows(nodes),
  };
}
