import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `mute <track>…` toggles, `unmute <track>…` always unmutes — e.g. `mute /vermona/kick /vermona/snare`. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "mute", "mute", "toggle", "toggle mute on one or more tracks");
  registerTrackSetCommand(api, "unmute", "mute", false, "unmute one or more tracks");
}
