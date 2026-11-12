import { normalizeTagNames } from "./plan.js";

// The tag editor page (plan 0010 "Build (0.1.8)"). Pure: the tracks and their tags in, the page data out;
// the page's answer in, the validated edits out. No Live access here.

export interface EditorTrack {
  /** Stable key of the track (its handle id). */
  id: string;
  name: string;
  /** The parent group's name, for display. */
  group?: string;
  tags: string[];
}

export type EditView = "list" | "grid";
export type FilterMode = "compact" | "highlight";

/** The data the page gets as `TAG_EDITOR`. Tracks in Set order. */
export interface TagEditorData {
  view: EditView;
  filter: FilterMode;
  help: string;
  gear: boolean;
  tracks: Array<{ id: string; name: string; group?: string }>;
  tags: Array<{ name: string; tracks: string[] }>;
  focus?: { tag?: string; track?: string };
}

/** The page's help line. */
export const EDITOR_HELP = "Space toggles · F2 renames · Shift+Backspace removes a tag · Ctrl+G switches view · Enter applies · Esc closes";

export interface EditorOptions {
  view: EditView;
  filter: FilterMode;
  /** Show the gear (`api.settings.gearAvailable()`). */
  gear: boolean;
  /** Open on this tag (a new name is added as an empty tag), or on the first tag when absent. */
  focusTag?: string;
  /** Open with this track in focus (its id). */
  focusTrack?: string;
}

/** Tags sorted by name, each with the ids of its tracks in Set order. */
export function buildEditor(tracks: EditorTrack[], options: EditorOptions): TagEditorData {
  const names = [...new Set(tracks.flatMap((t) => t.tags))];
  if (options.focusTag !== undefined && !names.includes(options.focusTag)) names.push(options.focusTag);
  names.sort((a, b) => a.localeCompare(b));
  const focus: TagEditorData["focus"] = {};
  const tag = options.focusTag ?? names[0];
  if (tag !== undefined) focus.tag = tag;
  if (options.focusTrack !== undefined && tracks.some((t) => t.id === options.focusTrack)) focus.track = options.focusTrack;
  return {
    view: options.view,
    filter: options.filter,
    help: EDITOR_HELP,
    gear: options.gear,
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, ...(t.group !== undefined ? { group: t.group } : {}) })),
    tags: names.map((name) => ({ name, tracks: tracks.filter((t) => t.tags.includes(name)).map((t) => t.id) })),
    ...(Object.keys(focus).length > 0 ? { focus } : {}),
  };
}

/** What the page may answer with Apply (everything is checked in `parseAnswer`). */
export interface EditorEdits {
  /** Old name -> new name (an existing name merges). */
  renames: Map<string, string>;
  /** Tag names (after the renames) to take off every track. */
  removed: Set<string>;
  /** Per track id, the tags to switch on and off (final names). */
  sets: Map<string, { on: string[]; off: string[] }>;
}

export type ParsedAnswer =
  | { kind: "closed" }
  | { kind: "settings" }
  | { kind: "apply"; edits: EditorEdits }
  | { kind: "error"; message: string };

const BAD = (name: unknown): string => `tag: "${String(name)}" is not a tag name — use lowercase letters, digits, - and _`;

function name1(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const checked = normalizeTagNames([value]);
  return checked.ok && checked.names.length === 1 ? checked.names[0] : undefined;
}

/**
 * The page's answer string, validated against what the request offered: unknown tag names, unknown track ids,
 * invalid names and wrong shapes are an error and nothing is written. Order of effect: renames, then removals
 * (names after the renames), then `set` with the tags' final names.
 */
export function parseAnswer(answer: string | null | undefined, request: TagEditorData): ParsedAnswer {
  if (!answer) return { kind: "closed" };
  let json: unknown;
  try {
    json = JSON.parse(answer);
  } catch {
    return { kind: "error", message: "tag: the editor answered something that is not JSON; nothing was written" };
  }
  if (typeof json !== "object" || json === null) return { kind: "error", message: "tag: the editor sent an answer of the wrong shape; nothing was written" };
  const body = json as { settings?: unknown; apply?: unknown };
  if (body.settings === true) return { kind: "settings" };
  const apply = body.apply as { rename?: unknown; remove?: unknown; set?: unknown } | undefined;
  const wrong = { kind: "error", message: "tag: the editor sent an answer of the wrong shape; nothing was written" } as const;
  if (typeof apply !== "object" || apply === null) return wrong;
  const known = new Set(request.tags.map((t) => t.name));
  const trackIds = new Set(request.tracks.map((t) => t.id));

  const renames = new Map<string, string>();
  if (apply.rename !== undefined) {
    if (!Array.isArray(apply.rename)) return wrong;
    for (const r of apply.rename as Array<{ from?: unknown; to?: unknown }>) {
      if (typeof r !== "object" || r === null || typeof r.from !== "string" || typeof r.to !== "string") return wrong;
      if (!known.has(r.from)) return { kind: "error", message: `tag: #${r.from} is not a tag of this Set; nothing was written` };
      const to = name1(r.to);
      if (to === undefined) return { kind: "error", message: BAD(r.to) };
      if (renames.has(r.from)) return { kind: "error", message: `tag: #${r.from} is renamed twice; nothing was written` };
      if (to !== r.from) renames.set(r.from, to);
    }
  }
  // Names that exist after the renames, plus names a rename created.
  const afterRename = new Set([...known].map((n) => renames.get(n) ?? n));

  const removed = new Set<string>();
  const renamedTo = new Set(renames.values());
  if (apply.remove !== undefined) {
    if (!Array.isArray(apply.remove)) return wrong;
    for (const tag of apply.remove as unknown[]) {
      if (typeof tag !== "string") return wrong;
      if (!afterRename.has(tag)) return { kind: "error", message: `tag: #${tag} is not a tag of this Set; nothing was written` };
      if (renamedTo.has(tag)) {
        const from = [...renames.entries()].find(([, to]) => to === tag)![0];
        return { kind: "error", message: `tag: #${from} cannot be renamed to #${tag}, which is being removed in the same Apply; nothing was written` };
      }
      removed.add(tag);
    }
  }

  const sets = new Map<string, { on: string[]; off: string[] }>();
  if (apply.set !== undefined) {
    if (!Array.isArray(apply.set)) return wrong;
    for (const s of apply.set as Array<{ tag?: unknown; track?: unknown; on?: unknown }>) {
      if (typeof s !== "object" || s === null || typeof s.track !== "string" || typeof s.on !== "boolean") return wrong;
      const tag = name1(s.tag);
      if (tag === undefined) return { kind: "error", message: BAD(s.tag) };
      if (!trackIds.has(s.track)) return { kind: "error", message: `tag: the editor named a track that does not exist (${s.track}); nothing was written` };
      if (renames.has(tag) && !afterRename.has(tag)) {
        return { kind: "error", message: `tag: #${tag} is renamed to #${renames.get(tag)} in this Apply; the editor must use the final name; nothing was written` };
      }
      if (removed.has(tag)) continue; // a removed tag is never set again
      const entry = sets.get(s.track) ?? { on: [], off: [] };
      // The last word on a (tag, track) pair wins.
      entry.on = entry.on.filter((n) => n !== tag);
      entry.off = entry.off.filter((n) => n !== tag);
      (s.on ? entry.on : entry.off).push(tag);
      sets.set(s.track, entry);
    }
  }
  return { kind: "apply", edits: { renames, removed, sets } };
}

const dedupe = (names: string[]): string[] => [...new Set(names)];

/** One track's tags after the edits: renames (a track with both names keeps one), removals, then the set. */
export function finalTags(before: string[], trackId: string, edits: EditorEdits): string[] {
  let tags = dedupe(before.map((t) => edits.renames.get(t) ?? t)).filter((t) => !edits.removed.has(t));
  const set = edits.sets.get(trackId);
  if (set) tags = dedupe([...tags, ...set.on]).filter((t) => !set.off.includes(t));
  return tags;
}

/** Tag names that exist on some track and would take a rename's new name: the merges to tell the user about. */
export function mergesOf(tracks: EditorTrack[], edits: EditorEdits): Array<[string, string]> {
  return [...edits.renames.entries()].filter(([from, to]) => to !== from && tracks.some((t) => t.tags.includes(to)) && !edits.removed.has(to));
}
