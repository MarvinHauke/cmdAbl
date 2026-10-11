import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `solo <track>…` / `unsolo <track>…`. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "solo", "solo", true, "solo one or more tracks");
  registerTrackSetCommand(api, "unsolo", "solo", false, "unsolo one or more tracks");
}
