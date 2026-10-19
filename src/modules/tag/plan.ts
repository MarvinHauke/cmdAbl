import { quoteIfNeeded } from "../../core/tokenize.js";

/** What `tag` should do with the names: set them, clear them or flip them. */
export type TagMode = "add" | "remove" | "toggle";

const NAME = /^[a-z0-9_-]+$/;

/**
 * Lowercase the words and check them: letters, digits, `-` and `_` (a leading
 * `#` is the sign, not part of the name). Returns the names without
 * duplicates in the order given, or the first word that is not a name.
 */
export function normalizeTagNames(words: string[]): { ok: true; names: string[] } | { ok: false; bad: string } {
  const names: string[] = [];
  for (const word of words) {
    const name = word.replace(/^#/, "").toLowerCase();
    if (!NAME.test(name)) return { ok: false, bad: word };
    if (!names.includes(name)) names.push(name);
  }
  return { ok: true, names };
}

/** One track's tags before and after, and what that changed. */
export interface TagChange {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}

/** Apply `names` to one track's tags. `toggle` decides per name by what the track has now. */
export function planTags(before: string[], names: string[], mode: TagMode): TagChange {
  const after = [...before];
  const added: string[] = [];
  const removed: string[] = [];
  for (const name of names) {
    const has = after.includes(name);
    const wantIt = mode === "add" ? true : mode === "remove" ? false : !has;
    if (wantIt && !has) {
      after.push(name);
      added.push(name);
    } else if (!wantIt && has) {
      after.splice(after.indexOf(name), 1);
      removed.push(name);
    }
  }
  return { before, after, added, removed };
}

/** What differs between two tag lists (e.g. before and as Live stored it). */
export function diffTags(before: string[], after: string[]): TagChange {
  return {
    before,
    after,
    added: after.filter((t) => !before.includes(t)),
    removed: before.filter((t) => !after.includes(t)),
  };
}

export const changed = (c: TagChange): boolean => c.added.length + c.removed.length > 0;

/**
 * The command lines that put a change back, since Cmd+Z does not undo tags:
 * `tag --set 0 /Lead fx` for what was added, `tag --set 1 /Lead drum` for what was removed.
 */
export function reverseLines(path: string, c: TagChange): string[] {
  const target = quoteIfNeeded(path);
  const lines: string[] = [];
  if (c.added.length > 0) lines.push(`tag --set 0 ${target} ${c.added.join(" ")}`);
  if (c.removed.length > 0) lines.push(`tag --set 1 ${target} ${c.removed.join(" ")}`);
  return lines;
}

/** Every tag of the Set with the paths of the tracks that carry it, tags in alphabetical order. */
export function tagIndex(tracks: Array<{ path: string; tags?: string[] }>): Array<{ tag: string; paths: string[] }> {
  const map = new Map<string, string[]>();
  for (const t of tracks) for (const tag of t.tags ?? []) map.set(tag, [...(map.get(tag) ?? []), t.path]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, paths]) => ({ tag, paths }));
}
