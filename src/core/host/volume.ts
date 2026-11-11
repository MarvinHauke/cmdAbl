// Track volume through the SDK (plan 0012): `mixer.volume` is a DeviceParameter whose value is 0..1
// (0.85 is 0 dB, 1 is the fader's top). Pure over a structural type so it is testable; extension.ts
// feeds it the SDK track. Never throws: a failing parameter answers null / false.

export interface VolumeParameter {
  getValue(): Promise<number>;
  setValue(value: number): Promise<void>;
}
export interface VolumeTrack {
  mixer: { volume: VolumeParameter };
}

/** The track's volume as 0..1, or null when there is no track or the read fails. */
export async function readVolume(track: VolumeTrack | null): Promise<number | null> {
  if (!track) return null;
  try {
    const value = await track.mixer.volume.getValue();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Set the track's volume (clamped to 0..1). The write starts synchronously, so called inside
 * `tracks.transaction(() => setVolume(...))` it joins that undo step; resolves true when it was
 * written, false when there is no track, the value is not a number or the write failed.
 */
export function writeVolume(track: VolumeTrack | null, value: number): Promise<boolean> {
  if (!track || !Number.isFinite(value)) return Promise.resolve(false);
  try {
    return track.mixer.volume.setValue(Math.min(1, Math.max(0, value))).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}
