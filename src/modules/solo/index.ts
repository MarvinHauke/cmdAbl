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
      { line: "solo bass", note: "solo or unsolo the track named like bass" },
      { line: "solo bass, lead", note: "several targets, separated by a comma" },
      { line: "solo --set 1 bass", note: "make sure the track is soloed" },
      { line: "solo --set 0 bass, lead", note: "make sure neither is soloed" },
      { line: "solo 808 bass", note: "words typed together name one object when they fit it (here the Bass Drum pad of the 808 Core Kit); if several fit you are asked, if none fits together each word is its own target" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
}
