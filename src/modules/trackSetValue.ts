/** What a track command writes: a fixed value, or "toggle" to flip each track's current one. */
export type TrackSetValue = boolean | "toggle";

/** The value to write to a track whose property is currently `current`. */
export function nextTrackValue(current: boolean, value: TrackSetValue): boolean {
  return value === "toggle" ? !current : value;
}

/**
 * Drop repeated targets (by Live position, not by name): `mute /a /a` or a
 * pick overlapping a typed path must not toggle the same track twice.
 */
export function uniqueTracks<T extends { scope: string; route: number[] }>(nodes: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const node of nodes) {
    const key = `${node.scope}:${node.route[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(node);
  }
  return out;
}
