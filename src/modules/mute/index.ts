import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `mute <track>…` / `unmute <track>…` — e.g. `mute /vermona/kick /vermona/snare`. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "mute", "mute", true, "mute one or more tracks");
  registerTrackSetCommand(api, "unmute", "mute", false, "unmute one or more tracks");
}
