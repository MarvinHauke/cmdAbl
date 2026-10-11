import type { ModuleApi } from "../types.js";
import { buildObjectTree, flattenObjectTree } from "../../ableton/objectTree.js";
import { resolvePath, uniquePath } from "../../ableton/resolvePath.js";
import { getBridge } from "../../ableton/bridge.js";
import { selectNodeResult } from "../selectNode.js";
import { ExitCode, fail, type CommandResult } from "../../types.js";
import { matches as matchesPattern } from "../../core/match.js";
import { MatchList } from "./matches.js";
import { findKinds } from "./kinds.js";

/**
 * `find <pattern> [-t] [-d] [-c]` — grep for the Live Set: every track/device/chain whose
 * path contains every word of the pattern. One match is selected directly; several are shown
 * in the pick list. `next` / `prev` then step through the matches.
 *
 * The only module that keeps state (the last match list) — in memory only.
 */
export function activate(api: ModuleApi): void {
  const matches = new MatchList();
  const liveNodes = () => flattenObjectTree(buildObjectTree(api.context));

  // Any pick list — including the one an ambiguous `goto` shows — becomes the
  // list `next`/`prev` walk.
  api.onPick((candidates, chosen) => {
    const all = liveNodes();
    const paths = candidates.map((n) => uniquePath(all, n));
    const current = chosen?.[0] ? candidates.findIndex((n) => n.handleId === chosen[0]!.handleId) : -1;
    matches.set(paths, current);
  });

  api.commands.add({
    name: "find",
    summary: "find tracks, devices and chains whose path contains a pattern",
    requires: ["bridge"],
    options: [
      { name: "tracks", short: "t", summary: "only tracks" },
      { name: "devices", short: "d", summary: "only devices" },
      { name: "chains", short: "c", summary: "only chains and drum pads" },
    ],
    args: [{ name: "pattern", kind: "text", rest: true }],
    run: async (invocation): Promise<CommandResult | void> => {
      const pattern = String(invocation.args[0]?.[0] ?? "");
      const kinds = findKinds(invocation.options);
      const all = liveNodes();
      const hits = all.filter((n) => kinds.includes(n.kind) && matchesPattern(n.path, pattern));
      if (hits.length === 0) return fail(ExitCode.NOT_FOUND, `find: nothing matches "${pattern}"`);

      if (hits.length === 1) {
        matches.set([uniquePath(all, hits[0]!)], 0);
        return selectNodeResult(getBridge(), hits[0]!);
      }
      const chosen = await api.pick(`find: "${pattern}" — ${hits.length} matches`, hits);
      if (chosen?.[0]) return selectNodeResult(getBridge(), chosen[0]);
    },
  });

  const stepCommand = (name: string, delta: 1 | -1, summary: string) =>
    api.commands.add({
      name,
      summary,
      requires: ["bridge"],
      run: async (): Promise<CommandResult> => {
        const entry = matches.step(delta);
        if (!entry) return fail(ExitCode.NOT_FOUND, `${name}: no matches to step through — run "find <pattern>" first`);
        const found = resolvePath(liveNodes(), entry.path);
        if (found.length !== 1) return fail(ExitCode.NOT_FOUND, `${name}: "${entry.path}" is no longer there`);
        const outcome = await selectNodeResult(getBridge(), found[0]!);
        // A failed select must not use up a step: go back so a re-run tries the same match.
        if (outcome.code !== 0) matches.step(delta === 1 ? -1 : 1);
        return outcome;
      },
    });
  stepCommand("next", 1, "go to the next match of the last find");
  stepCommand("prev", -1, "go to the previous match of the last find");
}
