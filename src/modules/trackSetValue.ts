import type { TrackScope } from "../types.js";

/** What a track command writes: a fixed value, or "toggle" to flip each track's current one. */
export type TrackSetValue = boolean | "toggle";

/** The value to write to a track whose property is currently `current`. */
export function nextTrackValue(current: boolean, value: TrackSetValue): boolean {
  return value === "toggle" ? !current : value;
}

/**
 * What to do when `arm` is to be set to `wanted` on a track in `scope`.
 * Return and main tracks cannot be armed: setting it would be a silent no-op,
 * so wanting it on is refused, and wanting it off is already true (skip).
 */
export type ArmDecision = "write" | "skip" | "refuse";

export function armDecision(scope: TrackScope | undefined, wanted: boolean): ArmDecision {
  if (scope === undefined || scope === "regular") return "write";
  return wanted ? "refuse" : "skip";
}

/** True when a read-back shows the write did not take (the track refused it). */
export function notChanged(wanted: boolean, actual: boolean): boolean {
  return actual !== wanted;
}
