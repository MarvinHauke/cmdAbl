// Shared shapes for the command-palette platform.
//
// Everything searchable in the palette is a PaletteItem, produced by a
// Provider. Today the only provider wraps the command registry, but tracks /
// devices / clips will plug in here later without the UI needing to change.

export interface FlagDef {
  name: string;
  description: string;
}

export type PaletteItemType = "command" | "track" | "device" | "clip" | "scene";

/**
 * Regular tracks, return tracks, and the main ("Master") track are three
 * separate, ungroupable collections in the LOM (song.tracks / .returnTracks /
 * .mainTrack) — re-resolving or selecting a track needs to know which one its
 * route indexes into. Devices inherit their track's scope. Defaults to
 * "regular" when absent (every Phase-1 item implicitly was).
 */
export type TrackScope = "regular" | "return" | "master";

export interface PaletteItem {
  /**
   * Identifier for the underlying thing. For commands this is the command
   * name; for Live objects it is the host handle id (as a string). Not a
   * permanent reference — objects are re-resolved at execute time.
   */
  id: string;
  type: PaletteItemType;
  /** Primary label shown in the palette. */
  title: string;
  /** Secondary text (e.g. a command's description). */
  subtitle?: string;
  /** Extra terms to match against during search. */
  keywords?: string[];
  /** Completable flags — commands only; drives the flag-completion phase. */
  flags?: FlagDef[];
  /** What to do with the item (e.g. "toggleMute"). Non-command items. */
  action?: string;
  /** Display/address path from the song root, e.g. "/Vermona/Kick". Live objects only. */
  path?: string;
  /**
   * Index chain into the track collection named by `scope`, e.g. [2, 1] =
   * <scope-collection>[2].devices[1]. Fallback for re-resolution when the
   * handle id no longer matches anything live.
   */
  route?: number[];
  /** Which track collection `route`'s first index resolves against. Tracks/devices only. */
  scope?: TrackScope;
}

/**
 * Structured payload the webview returns when the user picks an item. The
 * webview can only post a single string, so this is JSON-encoded across the
 * bridge and parsed back in the host.
 */
export interface PaletteResult {
  type: PaletteItemType;
  id: string;
  flags?: string[];
  /** Non-command action to perform (e.g. "toggleMute" on a track). */
  action?: string;
  /** Index chain fallback for re-resolving the object — see PaletteItem.route. */
  route?: number[];
  /** See PaletteItem.scope. */
  scope?: TrackScope;
}

export interface Provider {
  /** Contribute items to the palette snapshot taken when it opens. */
  getItems(): PaletteItem[] | Promise<PaletteItem[]>;
}
