// `tag --list` (plan 0010): one read-only row per tag, the untagged tracks as a last row nobody can pick.

export interface ListTrack {
  name: string;
  path: string;
  tags: string[];
}

export interface ListRow {
  label: string;
  detail: string;
  /** The tag the row stands for; absent on the untagged row. */
  tag?: string;
}

const MAX_NAMES = 8;

const names = (tracks: ListTrack[]): string => {
  const shown = tracks.slice(0, MAX_NAMES).map((t) => t.name);
  return tracks.length > MAX_NAMES ? `${shown.join(", ")}, +${tracks.length - MAX_NAMES}` : shown.join(", ");
};

/** `#drums · 3 · Kick, Snare, Hat`: the label is `#drums`, the detail `3 · Kick, Snare, Hat`. Tags by name. */
export function listRows(tracks: ListTrack[]): ListRow[] {
  const tags = [...new Set(tracks.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b));
  const rows: ListRow[] = tags.map((tag) => {
    const carrying = tracks.filter((t) => t.tags.includes(tag));
    return { label: `#${tag}`, detail: `${carrying.length} · ${names(carrying)}`, tag };
  });
  const untagged = tracks.filter((t) => t.tags.length === 0);
  if (untagged.length > 0) rows.push({ label: "untagged", detail: `${untagged.length} · ${names(untagged)}` });
  return rows;
}

/** The setting `tag.listEnter` with `{}` replaced by the tag (every `{}`). */
export const listEnterLine = (template: string, tag: string): string => template.split("{}").join(tag);
