import type { ModuleApi } from "../types.js";
import { registerTrackSetCommand } from "../trackSetCommand.js";

/** `mute <target>…` toggles; `mute --set 1|0 <target>…` makes every target muted or not — e.g. `mute /vermona/kick /vermona/snare`. */
export function activate(api: ModuleApi): void {
  registerTrackSetCommand(api, "mute", "mute", "toggle mute on tracks, chains and drum pads", {
    description:
      "Switches mute on for each target that is not muted and off for each that is, one by one. " +
      "With --set 1 every target ends up muted, with --set 0 unmuted, whatever it was before; " +
      "a target that is already in that state counts as done. " +
      "Works on tracks, rack chains and Drum Rack pads. Tracks work on their own; chains and pads need the " +
      "cmdAbl Remote Script and macOS. When a word matches several objects you are asked to choose.",
    examples: [
      { line: "mute /Kick", note: "mute or unmute the track Kick" },
      { line: "mute /Kick, /Snare", note: "several targets, separated by a comma" },
      { line: "mute --set 1 /Kick, /Snare", note: "make sure both are muted" },
      { line: "mute --set 0 /Kick", note: "make sure Kick is not muted" },
      { line: "mute vermona kick", note: "words that all occur in one path; if each word also names something on its own, you are asked which you mean" },
    ],
    targetSummary: "Tracks, rack chains or Drum Rack pads; separate several with commas",
  });
}
