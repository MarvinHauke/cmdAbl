import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `mute <target>…` toggles; `mute --set 1|0 <target>…` makes every target muted or not — e.g. `mute bass, lead`. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "mute", "mute", "toggle mute on tracks, chains and drum pads", {
    description:
      "Switches mute on for each target that is not muted and off for each that is, one by one. " +
      "With --set 1 every target ends up muted, with --set 0 unmuted, whatever it was before; " +
      "a target that is already in that state counts as done. " +
      "Works on tracks, rack chains and Drum Rack pads. Tracks work on their own; chains and pads need the " +
      "cmdAbl Remote Script and macOS. When the words match several objects you are asked to choose.",
    examples: [
      { line: "mute bass", note: "mute or unmute the track named like bass" },
      { line: "mute bass, lead", note: "several targets, separated by a comma" },
      { line: "mute --set 1 bass, lead", note: "make sure both are muted" },
      { line: "mute --set 0 bass, lead", note: "make sure neither is muted" },
      { line: "mute 808 snare", note: "words typed together name one object when they fit it (here the Snare Drum pad of the 808 Core Kit); if several fit you are asked, if none fits together each word is its own target" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
}
