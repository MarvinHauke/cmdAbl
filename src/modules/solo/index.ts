import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

const NEEDS_SCRIPT = "Tracks work on their own; chains and pads need the cmdAbl Remote Script and macOS.";
const EXCLUSIVE = "Live's Exclusive Solo setting is not applied: naming several targets solos all of them.";

/** `solo <track>…` toggles, `unsolo <track>…` always unsolos. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "solo", "solo", "toggle", "toggle solo on tracks, chains and drum pads", {
    description:
      "Switches solo on for each target that is not soloed and off for each that is, one by one. " +
      `Works on tracks, rack chains and Drum Rack pads. ${NEEDS_SCRIPT} ${EXCLUSIVE}`,
    examples: [
      { line: "solo /Kick", note: "solo or unsolo the track Kick" },
      { line: "solo /Kick, /Snare", note: "several targets, separated by a comma" },
      { line: "solo vermona kick", note: "words that all occur in one path; if each word also names something on its own, you are asked which you mean" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
  registerTrackSetCommand(api, "unsolo", "solo", false, "unsolo tracks, chains and drum pads", {
    description:
      "Switches solo off for each target. Running it again changes nothing. " +
      `Works on tracks, rack chains and Drum Rack pads. ${NEEDS_SCRIPT}`,
    examples: [
      { line: "unsolo /Kick", note: "unsolo the track Kick" },
      { line: "unsolo /Kick, /Snare", note: "several targets, separated by a comma" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
}
