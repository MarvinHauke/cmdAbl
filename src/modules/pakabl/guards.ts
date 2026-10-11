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

/** True only for an https URL equal to the repo URL of some index entry. */
export function isKnownRepoUrl(url: string, entries: readonly { url: string }[]): boolean {
  if (!url.startsWith("https://")) return false;
  return entries.some((e) => repoUrl(e.url) === url);
}
