import type { ModuleApi } from "../types.js";
import { registerTrackToggleCommand } from "../trackToggleCommand.js";

/** `mute <path>[, <path> …]` — toggle mute on one or more tracks by address (e.g. "mute /vermona/kick, /vermona/snare"). */
export function activate(api: ModuleApi): void {
  registerTrackToggleCommand(api, "mute", "mute");
}
