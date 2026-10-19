import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `arm <track>…` toggles record arm; `arm --set 1|0 <track>…` makes every track armed or not. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "arm", "arm", "toggle record arm on tracks", {
    description:
      "Switches record arm on for each track that is not armed and off for each that is, one by one. " +
      "With --set 1 every track ends up armed, with --set 0 not armed, whatever it was before; " +
      "a track that is already in that state counts as done. " +
      "Return, main and group tracks cannot be armed and are reported as failed (disarming them is a no-op). " +
      "With the cmdAbl Remote Script running, tracks Live refuses to arm (for example a MIDI track whose input " +
      "device is not available) are reported as failed too. Live's Exclusive Arm setting is not applied: " +
      "naming several tracks arms all of them.",
    examples: [
      { line: "arm /Bass", note: "arm or disarm the track Bass" },
      { line: "arm /Bass, /Lead", note: "several tracks, separated by a comma" },
      { line: "arm --set 1 /Bass", note: "make sure Bass is armed" },
      { line: "arm --set 0 /Bass, /Lead", note: "disarm both" },
    ],
    targetSummary: "Tracks to arm; separate several with commas",
  });
}
