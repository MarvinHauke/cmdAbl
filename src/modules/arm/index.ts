import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `arm <track>…` / `unarm <track>…` — record-arm tracks. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "arm", "arm", true, "arm one or more tracks for recording");
  registerTrackSetCommand(api, "unarm", "arm", false, "disarm one or more tracks");
}
