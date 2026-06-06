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

export interface PaletteItem {
  /** Stable identifier. For commands this is the command name. */
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
  /** Reserved for non-command actions (e.g. "mute" on a track). */
  action?: string;
}

export interface Provider {
  /** Contribute items to the palette snapshot taken when it opens. */
  getItems(): PaletteItem[] | Promise<PaletteItem[]>;
}
