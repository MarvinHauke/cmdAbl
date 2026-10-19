/** A parsed semantic version: `1.2.3`, `1.2.3-beta.1`, a leading `v` and `+build` are tolerated. */
interface Semver {
  core: [number, number, number];
  pre: string[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(text: string): Semver | null {
  const m = SEMVER.exec(text.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

const isNumeric = (s: string) => /^\d+$/.test(s);

/**
 * Compare two versions by the semver rules (a version with a prerelease is
 * lower than the same without; numeric identifiers compare as numbers and are
 * lower than text ones; build metadata is ignored). -1: a < b, 0: equal,
 * 1: a > b, null: one of them is not a semantic version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x.core[i]! !== y.core[i]!) return x.core[i]! < y.core[i]! ? -1 : 1;
  }
  if (x.pre.length === 0 || y.pre.length === 0) {
    return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (isNumeric(p) && isNumeric(q)) return Number(p) < Number(q) ? -1 : 1;
    if (isNumeric(p) !== isNumeric(q)) return isNumeric(p) ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** How the index version relates to the installed one. */
export type IndexRelation = "newer" | "same" | "older" | "unknown";

export function indexRelation(installed: string, index: string): IndexRelation {
  if (installed === index) return "same";
  const c = compareVersions(index, installed);
  return c === null ? "unknown" : c > 0 ? "newer" : c < 0 ? "older" : "same";
}

/** How the installed version relates to the index's: "newer" means the installed one is newer. */
export function installedRelation(installed: string, index: string): IndexRelation {
  if (installed === index) return "same";
  const c = compareVersions(installed, index);
  return c === null ? "unknown" : c > 0 ? "newer" : c < 0 ? "older" : "same";
}
