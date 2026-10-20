import type { BoardAnswer, BoardRequest } from "../../core/ui.js";
import { normalizeTagNames } from "./plan.js";

// `tag --list` on the `board` surface (plan 0010). Pure: the tracks and their tags in, the request out;
// the answer in, the changes per track out.

export interface BoardTrack {
  /** Stable key of the track (its handle id). */
  id: string;
  /** What the item shows: the track's path. */
  label: string;
  tags: string[];
}

export const UNTAGGED_ID = "~untagged"; // not a tag name, so no tag can clash with it
const tagId = (name: string): string => `tag:${name}`;

/** Allowed names for the "New tag…" field: the tag rule; uppercase is accepted and lowercased by the module. */
export const NEW_TAG_PATTERN = "#?[A-Za-z0-9_-]+";

/** One section per tag (sorted by name), a read-only "untagged" section at the end. */
export function buildBoard(tracks: BoardTrack[]): BoardRequest {
  const names = [...new Set(tracks.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b));
  const sections: BoardRequest["sections"] = names.map((name) => {
    const count = tracks.filter((t) => t.tags.includes(name)).length;
    return {
      id: tagId(name),
      heading: `#${name}`,
      meta: `${count} ${count === 1 ? "track" : "tracks"}`,
      items: tracks.map((t) => ({ id: t.id, label: t.label, on: t.tags.includes(name) })),
    };
  });
  const untagged = tracks.filter((t) => t.tags.length === 0);
  if (untagged.length > 0) {
    sections.push({
      id: UNTAGGED_ID,
      heading: "untagged",
      meta: `${untagged.length} ${untagged.length === 1 ? "track" : "tracks"}`,
      items: untagged.map((t) => ({ id: t.id, label: t.label, on: true })),
      readonly: true,
    });
  }
  return {
    title: "tag",
    sections,
    create: { label: "New tag…", pattern: NEW_TAG_PATTERN },
    apply: { label: "Apply" },
  };
}

export interface TrackChange {
  add: string[];
  remove: string[];
}

/**
 * The answer's changes grouped per track. A section is a tag of the request (`tag:<name>`) or a created
 * name (as typed); a name that is no valid tag (after lowercasing and dropping a leading #) is reported in `bad`.
 */
export function groupChanges(answer: BoardAnswer): { perTrack: Map<string, TrackChange>; bad?: string } {
  const perTrack = new Map<string, TrackChange>();
  for (const change of answer.changes) {
    let name: string;
    if (change.section.startsWith("tag:") && !answer.created.includes(change.section)) name = change.section.slice(4);
    else {
      const checked = normalizeTagNames([change.section]);
      if (!checked.ok || checked.names.length !== 1) return { perTrack, bad: change.section };
      name = checked.names[0]!;
    }
    const entry = perTrack.get(change.item) ?? { add: [], remove: [] };
    (change.on ? entry.add : entry.remove).push(name);
    perTrack.set(change.item, entry);
  }
  // A created name that equals an existing tag merges into it; where one section ticks and the other
  // unticks the same track, the tick wins (a new section only ever adds).
  for (const entry of perTrack.values()) entry.remove = entry.remove.filter((n) => !entry.add.includes(n));
  return { perTrack };
}
