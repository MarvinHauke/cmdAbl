import type { ModuleApi } from "../types.js";
import { registerTrackToggleCommand } from "../trackToggleCommand.js";

/** `solo <path>[, <path> …]` — toggle solo on one or more tracks by address (e.g. "solo /vermona/kick, /vermona/snare"). */
export function activate(api: ModuleApi): void {
  registerTrackToggleCommand(api, "solo", "solo");
}
