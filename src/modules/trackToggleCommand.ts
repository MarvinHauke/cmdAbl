import type { ModuleApi } from "./types.js";
import { findTrackByPath } from "../ableton/trackLookup.js";

// Shared by mute/solo — both are "toggle this boolean on one or more tracks
// addressed by path" commands that differ only in which property they flip.
// Comma-separated targets (rather than splitting on whitespace) because track
// names routinely contain spaces ("Opal Lead"), which would make a bare-space
// delimiter ambiguous with the path itself.

export function registerTrackToggleCommand(api: ModuleApi, name: "mute" | "solo", prop: "mute" | "solo"): void {
  const verb = name === "mute" ? "mute/unmute" : "solo/unsolo";
  api.registry.register(name, `${verb} one or more tracks by path`, (flags) => {
    const query = flags.join(" ").trim();
    if (!query) {
      api.showFeedback(`cmdAbl: usage: ${name} <path>[, <path> …]`);
      return;
    }
    const paths = query.split(",").map((p) => p.trim()).filter(Boolean);
    const misses: string[] = [];
    for (const path of paths) {
      const track = findTrackByPath(api.context, path);
      if (!track) {
        misses.push(path);
        continue;
      }
      track[prop] = !track[prop];
    }
    if (misses.length) {
      api.showFeedback(`cmdAbl: no track matches: ${misses.join(", ")}`);
    }
  });
}
