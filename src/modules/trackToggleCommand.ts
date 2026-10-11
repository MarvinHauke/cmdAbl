import type { ModuleApi } from "./types.js";
import { findTracksByPath, trackFor } from "../ableton/trackLookup.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../types.js";

// Shared by mute/solo — both are "toggle this boolean on one or more tracks
// addressed by path" commands that differ only in which property they flip.
// Comma-separated targets (rather than splitting on whitespace) because track
// names routinely contain spaces ("Opal Lead"), which would make a bare-space
// delimiter ambiguous with the path itself.

export function registerTrackToggleCommand(api: ModuleApi, name: "mute" | "solo", prop: "mute" | "solo"): void {
  const verb = name === "mute" ? "mute/unmute" : "solo/unsolo";
  api.registry.register(name, `${verb} one or more tracks by path`, (flags): CommandResult => {
    const query = flags.join(" ").trim();
    if (!query) return fail(ExitCode.USAGE, `usage: ${name} <path>[, <path> …]`);

    const paths = query.split(",").map((p) => p.trim()).filter(Boolean);
    const outcomes: TargetOutcome[] = [];
    for (const path of paths) {
      const matches = findTracksByPath(api.context, path);
      if (matches.length === 0) {
        outcomes.push({ path, ok: false, code: ExitCode.NOT_FOUND, message: "no track matches" });
        continue;
      }
      if (matches.length > 1) {
        outcomes.push({
          path,
          ok: false,
          code: ExitCode.AMBIGUOUS,
          message: `ambiguous: ${matches.map((m) => m.path).join(", ")}`,
        });
        continue;
      }
      const track = trackFor(api.context, matches[0]!);
      if (!track) {
        outcomes.push({ path, ok: false, code: ExitCode.NOT_FOUND, message: "track is gone" });
        continue;
      }
      track[prop] = !track[prop];
      outcomes.push({ path: matches[0]!.path, ok: true });
    }

    const failed = outcomes.filter((o) => !o.ok);
    if (failed.length === 0) return ok();
    // One target: surface its specific code; several: an overall (partial) failure.
    const code = outcomes.length === 1 ? (failed[0]!.code ?? ExitCode.FAILURE) : ExitCode.FAILURE;
    const done = outcomes.length - failed.length;
    return fail(code as Exclude<typeof code, 0>, `${name}: ${done}/${outcomes.length} done`, outcomes);
  });
}
