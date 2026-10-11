import type { TrackFacts } from "../ableton/bridgeOps.js";
import { TEXT_STALE, type BridgeResult } from "../ableton/bridgeProtocol.js";
import type { TrackScope } from "../types.js";

/** What a track command writes: a fixed value, or "toggle" to flip each track's current one. */
export type TrackSetValue = boolean | "toggle";

/** The value to write to a track whose property is currently `current`. */
export function nextTrackValue(current: boolean, value: TrackSetValue): boolean {
  return value === "toggle" ? !current : value;
}

/**
 * A group track is a track node with track children (a group inside a group
 * has its own track children, so nesting needs no extra rule). Devices are
 * also children, hence the kind check. The SDK's track has no "is a group"
 * field (only `groupTrack` on the child), so a group with no child tracks
 * would not be recognised; Live is not believed to keep an empty group.
 */
export function isGroupNode(node: { children: readonly { kind: string }[] }): boolean {
  return node.children.some((c) => c.kind === "track");
}

/**
 * What to do when `arm` is to be set to `wanted`. Return, main and group
 * tracks cannot be armed, and asking Live anyway is not a harmless no-op, so
 * wanting it on is refused before any write; wanting it off is already true
 * (skip).
 */
export type ArmDecision = "write" | "skip" | "refuse";

export function armDecision(scope: TrackScope | undefined, wanted: boolean, isGroup = false): ArmDecision {
  const armable = (scope === undefined || scope === "regular") && !isGroup;
  if (armable) return "write";
  return wanted ? "refuse" : "skip";
}

/** The message for a refused arm. */
export function armRefusal(isGroup: boolean): string {
  return isGroup ? "group tracks cannot be armed" : "cannot be armed";
}

/** True when a read-back shows the write did not take (the track refused it). */
export function notChanged(wanted: boolean, actual: boolean): boolean {
  return actual !== wanted;
}

/**
 * The refusal text for a track whose Live facts say it cannot be armed (a MIDI
 * track with a missing input device is greyed out but accepts the SDK write
 * silently), or the bridge's own text when that track's entry says the Set
 * changed. Undefined = no objection; also when no facts were available.
 */
export function factsRefusal(entry: BridgeResult<TrackFacts> | undefined, wantedOn = true): string | undefined {
  if (!entry) return undefined;
  // Only "the Set changed" is an objection; any other failed entry (a read that
  // raised in the script) leaves the track to the SDK-only path.
  if (!entry.ok) return entry.text === TEXT_STALE ? entry.text : undefined;
  if (!wantedOn) return undefined; // switching off is never refused
  if (entry.value.isGroup) return armRefusal(true);
  if (!entry.value.canBeArmed) return "Live does not allow arming this track (e.g. no input device)";
  return undefined;
}
