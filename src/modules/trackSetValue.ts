/** What a track command writes: a fixed value, or "toggle" to flip each track's current one. */
export type TrackSetValue = boolean | "toggle";

/** The value to write to a track whose property is currently `current`. */
export function nextTrackValue(current: boolean, value: TrackSetValue): boolean {
  return value === "toggle" ? !current : value;
}
