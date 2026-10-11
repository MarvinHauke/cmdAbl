import type { ModuleApi } from "../types.js";
import type { PaletteResult } from "../../types.js";
import { snapshotObjectTree } from "./snapshot.js";
import { resolveRef } from "./resolve.js";
import { selectTrack, selectDevice } from "../../ableton/bridge.js";
import { buildObjectTree, flattenObjectTree } from "../../ableton/objectTree.js";
import { resolvePath } from "../../ableton/resolvePath.js";
import { ExitCode, fail } from "../../types.js";

/**
 * Surfaces the Set's addressable objects (tracks, group tracks, devices) in
 * the palette and routes their selection through the companion Remote Script
 * — the cmdAbl functionality that resolves "go to this object" requests.
 */
export function activate(api: ModuleApi): void {
  api.registerProvider({ getItems: () => snapshotObjectTree(api.context) });

  // `goto <path>` — the typed counterpart of picking an object in the palette.
  // Resolves against the live tree; several matches are reported, never guessed.
  api.registry.register("goto", "select a track or device by path", (flags) => {
    const query = flags.join(" ").trim();
    if (!query) return fail(ExitCode.USAGE, "usage: goto <path>");
    const matches = resolvePath(flattenObjectTree(buildObjectTree(api.context)), query);
    if (matches.length === 0) return fail(ExitCode.NOT_FOUND, `goto: nothing matches "${query}"`);
    if (matches.length > 1) {
      const shown = matches.slice(0, 12).map((m) => m.path);
      const more = matches.length > shown.length ? `\n… and ${matches.length - shown.length} more` : "";
      return { code: ExitCode.AMBIGUOUS, message: `goto: "${query}" is ambiguous:\n${shown.join("\n")}${more}`, candidates: matches.map((m) => m.path) };
    }
    const target = matches[0]!;
    if (target.kind === "track") selectTrack(target.scope, target.route[0]!);
    else selectDevice(target.scope, target.route[0]!, target.route[1]!);
  });

  api.registerResultHandler("select", (result: PaletteResult): void => {
    // Selection lives in the LOM, not the Extensions SDK, so we hand the
    // object's current route to the companion Remote Script over UDP.
    const resolved = resolveRef(api.context, result);
    if (!resolved) {
      api.showFeedback(`cmdAbl: that ${result.type} is no longer available.`);
      return;
    }
    if (resolved.kind === "track") selectTrack(resolved.scope, resolved.route[0]);
    else selectDevice(resolved.scope, resolved.route[0], resolved.route[1]);
  });
}
