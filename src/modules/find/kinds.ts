import type { PaletteItemType } from "../../core/types.js";

/**
 * Which object kinds `find` looks at: the kinds named by `-t` (tracks), `-d`
 * (devices) and `-c` (chains, i.e. rack chains and Drum Rack pads) — several
 * flags add up — or all of them when none is given.
 */
export function findKinds(options: Record<string, string | true | undefined>): PaletteItemType[] {
  const kinds: PaletteItemType[] = [];
  if (options.tracks) kinds.push("track");
  if (options.devices) kinds.push("device");
  if (options.chains) kinds.push("chain");
  return kinds.length > 0 ? kinds : ["track", "device", "chain"];
}
