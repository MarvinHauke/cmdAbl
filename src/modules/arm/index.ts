import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `arm <track>…` toggles record arm, `unarm <track>…` always disarms. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "arm", "arm", "toggle", "toggle record arm on tracks", {
    description:
      "Switches record arm on for each track that is not armed and off for each that is, one by one. " +
      "Return, main and group tracks cannot be armed and are reported as failed. With the cmdAbl Remote Script " +
      "running, tracks Live refuses to arm (for example a MIDI track whose input device is not available) " +
      "are reported as failed too. Live's Exclusive Arm setting is not applied: naming several tracks arms all of them.",
    examples: [
      { line: "arm /Bass", note: "arm or disarm the track Bass" },
      { line: "arm /Bass, /Lead", note: "several tracks, separated by a comma" },
    ],
    targetSummary: "Tracks to arm; separate several with commas",
  });
  registerTrackSetCommand(api, "unarm", "arm", false, "disarm tracks", {
    description:
      "Switches record arm off for each track. A track that is already off stays off, " +
      "so running it again changes nothing.",
    examples: [
      { line: "unarm /Bass", note: "disarm the track Bass" },
      { line: "unarm /Bass, /Lead", note: "several tracks, separated by a comma" },
    ],
    targetSummary: "Tracks to disarm; separate several with commas",
  });
}
