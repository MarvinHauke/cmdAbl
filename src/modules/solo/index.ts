import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `solo <target>…` toggles; `solo --set 1|0 <target>…` makes every target soloed or not. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "solo", "solo", "toggle solo on tracks, chains and drum pads", {
    description:
      "Switches solo on for each target that is not soloed and off for each that is, one by one. " +
      "With --set 1 every target ends up soloed, with --set 0 not soloed, whatever it was before; " +
      "a target that is already in that state counts as done. " +
      "Works on tracks, rack chains and Drum Rack pads. Tracks work on their own; chains and pads need the " +
      "cmdAbl Remote Script and macOS. Live's Exclusive Solo setting is not applied: naming several targets solos all of them.",
    examples: [
      { line: "solo /Kick", note: "solo or unsolo the track Kick" },
      { line: "solo /Kick, /Snare", note: "several targets, separated by a comma" },
      { line: "solo --set 1 /Kick", note: "make sure Kick is soloed" },
      { line: "solo --set 0 /Kick, /Snare", note: "make sure neither is soloed" },
      { line: "solo vermona kick", note: "words that all occur in one path; if each word also names something on its own, you are asked which you mean" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
}
