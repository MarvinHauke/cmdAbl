import * as path from "node:path";

// Pure checks for data that comes from the downloaded index or from the page.
// An extension id ends up in a path that is unzipped into and, for uninstall,
// deleted recursively, so it is validated where it enters.

// `<author-slug>.<name-slug>` as the crawler builds it (scripts/pakabl-crawl.ts):
// each slug is lowercase a-z/0-9 runs joined by single dashes.
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const ID_RE = new RegExp(`^${SLUG}\\.${SLUG}$`);

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * Keep entries with a valid id and an https download URL (a leading `-` would
 * be read by curl as an option, `file://` would copy a local file); `dropped`
 * counts the rest.
 */
export function filterValidEntries<T extends { id: unknown; url: unknown }>(
  entries: readonly T[],
): { valid: T[]; dropped: number } {
  const valid = entries.filter(
    (e) =>
      e !== null &&
      typeof e === "object" &&
      isValidId(e.id) &&
      typeof e.url === "string" &&
      e.url.startsWith("https://"),
  );
  return { valid, dropped: entries.length - valid.length };
}

/**
 * The folder for an extension id inside `root`, or undefined unless the id is
 * valid and the resolved folder is a direct child of `root`.
 */
export function extensionDir(root: string, id: string): string | undefined {
  if (!isValidId(id)) return undefined;
  const base = path.resolve(root);
  const dir = path.resolve(base, id);
  return path.dirname(dir) === base && dir !== base ? dir : undefined;
}

/** Repo page derived from an index download URL (GitHub release or raw file). */
export function repoUrl(downloadUrl: string): string | undefined {
  const m = downloadUrl.match(/^https:\/\/(?:github\.com|raw\.githubusercontent\.com)\/([^/]+)\/([^/]+)\//);
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

export interface Stat {
  stars: number;
  downloads: number | null;
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/**
 * Read the downloaded stats.json (`{ updated, stats: { id: { stars, downloads } } }`): only ids in
 * `ids`, only non-negative integers (`downloads` may be null). Anything else is dropped; a file of
 * the wrong shape gives an empty map.
 */
export function parseStats(raw: unknown, ids: ReadonlySet<string>): Map<string, Stat> {
  const out = new Map<string, Stat>();
  const stats = raw !== null && typeof raw === "object" ? (raw as { stats?: unknown }).stats : undefined;
  if (stats === null || typeof stats !== "object" || Array.isArray(stats)) return out;
  for (const [id, v] of Object.entries(stats)) {
    if (!ids.has(id) || v === null || typeof v !== "object") continue;
    const { stars, downloads } = v as { stars?: unknown; downloads?: unknown };
    if (!isCount(stars) || !(downloads === null || isCount(downloads))) continue;
    out.set(id, { stars, downloads });
  }
  return out;
}

/** Counts older than this are not shown (a later `pakabl update` could not refresh them). */
export const STATS_MAX_AGE_DAYS = 7;

/** Whether the file's `updated` date (YYYY-MM-DD) is recent enough; false for a missing or unreadable date. */
export function statsFresh(raw: unknown, now: Date): boolean {
  const updated = raw !== null && typeof raw === "object" ? (raw as { updated?: unknown }).updated : undefined;
  if (typeof updated !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(updated)) return false;
  const t = Date.parse(updated.slice(0, 10));
  return Number.isFinite(t) && now.getTime() - t <= STATS_MAX_AGE_DAYS * 86_400_000;
}
