import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `solo <track>…` toggles, `unsolo <track>…` always unsolos. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "solo", "solo", "toggle", "toggle solo on one or more tracks");
  registerTrackSetCommand(api, "unsolo", "solo", false, "unsolo one or more tracks");
}
