import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

const NEEDS_SCRIPT = "Tracks work on their own; chains and pads need the cmdAbl Remote Script and macOS.";

/** `mute <track>…` toggles, `unmute <track>…` always unmutes — e.g. `mute /vermona/kick /vermona/snare`. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "mute", "mute", "toggle", "toggle mute on tracks, chains and drum pads", {
    description:
      "Switches mute on for each target that is not muted and off for each that is, one by one. " +
      `Works on tracks, rack chains and Drum Rack pads. ${NEEDS_SCRIPT} ` +
      "When a word matches several objects you are asked to choose.",
    examples: [
      { line: "mute /Kick", note: "mute or unmute the track Kick" },
      { line: "mute /Kick, /Snare", note: "several targets, separated by a comma" },
      { line: "mute vermona kick", note: "words that all occur in one path; if each word also names something on its own, you are asked which you mean" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
  registerTrackSetCommand(api, "unmute", "mute", false, "unmute tracks, chains and drum pads", {
    description:
      "Switches mute off for each target. Running it again changes nothing. " +
      `Works on tracks, rack chains and Drum Rack pads. ${NEEDS_SCRIPT}`,
    examples: [
      { line: "unmute /Kick", note: "unmute the track Kick" },
      { line: "unmute /Kick, /Snare", note: "several targets, separated by a comma" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
}
