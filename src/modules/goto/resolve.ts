import type { Device, ExtensionContext, Track } from "@ableton-extensions/sdk";
import type { PaletteResult, TrackScope } from "../../types.js";

export type ResolvedObject =
  | { kind: "track"; object: Track<"1.0.0">; scope: TrackScope; route: [number] }
  | { kind: "device"; object: Device<"1.0.0">; scope: TrackScope; route: [number, number] };

// Snapshot handles are not permanent (moving/deleting an object invalidates
// them) and the SDK forbids reconstructing one from a stored id. So — as in
// Phase 1's resolveTrackIndex — we re-walk the live model and match the
// addressed object's handle id to find its *current* position. Generalized
// past a single flat list: walk every track in the ref's scoped collection
// (and, for device refs, every device on it) until the id matches; chains and
// other kinds extend the same way. Falls back to the recorded route if the
// object is gone, mirroring resolveTrackIndex's index fallback.

function trackCollectionFor(context: ExtensionContext<"1.0.0">, scope: TrackScope): Track<"1.0.0">[] {
  const song = context.application.song;
  if (scope === "return") return song.returnTracks;
  if (scope === "master") return [song.mainTrack];
  return song.tracks;
}

export function resolveRef(
  context: ExtensionContext<"1.0.0">,
  result: PaletteResult,
): ResolvedObject | null {
  if (result.type !== "track" && result.type !== "device") return null;
  const scope: TrackScope = result.scope ?? "regular";
  const tracks = trackCollectionFor(context, scope);

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex];
    if (result.type === "track" && track.handle.id.toString() === result.id) {
      return { kind: "track", object: track, scope, route: [trackIndex] };
    }
    if (result.type === "device") {
      const devices = track.devices;
      for (let deviceIndex = 0; deviceIndex < devices.length; deviceIndex++) {
        if (devices[deviceIndex].handle.id.toString() === result.id) {
          return { kind: "device", object: devices[deviceIndex], scope, route: [trackIndex, deviceIndex] };
        }
      }
    }
  }

  return resolveByRoute(result, scope, tracks);
}

function resolveByRoute(
  result: PaletteResult,
  scope: TrackScope,
  tracks: Track<"1.0.0">[],
): ResolvedObject | null {
  const [trackIndex, deviceIndex] = result.route ?? [];
  if (trackIndex === undefined || trackIndex >= tracks.length) return null;
  const track = tracks[trackIndex];

  if (result.type === "track") return { kind: "track", object: track, scope, route: [trackIndex] };

  if (deviceIndex === undefined || deviceIndex >= track.devices.length) return null;
  return { kind: "device", object: track.devices[deviceIndex], scope, route: [trackIndex, deviceIndex] };
}
