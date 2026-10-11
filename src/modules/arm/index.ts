import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `arm <track>…` toggles record arm, `unarm <track>…` always disarms. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "arm", "arm", "toggle", "toggle record arm on one or more tracks");
  registerTrackSetCommand(api, "unarm", "arm", false, "disarm one or more tracks");
}
