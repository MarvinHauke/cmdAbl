import type { ModuleApi } from "../types.js";
import { resolveStructural, uniquePath } from "../../ableton/resolvePath.js";
import { selectNodeResult } from "../selectNode.js";
import { ExitCode, fail, type CommandResult } from "../../core/types.js";
import { MatchList } from "./matches.js";
import { findKinds } from "./kinds.js";
import { findNodes } from "./select.js";

/**
 * `find [pattern] [-L <n>] [-t] [-d] [-c]` — grep for the Live Set: every track/device/chain
 * whose path contains every word of the pattern (a search); `-L` limits how far below an
 * object whose own name matches the results go. One match is selected directly; several are
 * shown in the pick list. `next` / `prev` then step through the matches.
 *
 * The only module that keeps state (the last match list) — in memory only.
 */
export function activate(api: ModuleApi): void {
  const matches = new MatchList();
  // `--unfold` of the `find` that made the list: next/prev keep it. Any other
  // pick list (an ambiguous goto) starts without it.
  let unfold = false;
  const liveNodes = () => api.liveSet.nodes();

  // Any pick list — including the one an ambiguous `goto` shows — becomes the
  // list `next`/`prev` walk.
  api.onPick((candidates, chosen) => {
    const all = liveNodes();
    const paths = candidates.map((n) => uniquePath(all, n));
    const current = chosen?.[0] ? candidates.findIndex((n) => n.handleId === chosen[0]!.handleId) : -1;
    matches.set(paths, current);
    unfold = false;
  });

  api.commands.add({
    name: "find",
    summary: "find tracks, devices and chains whose path contains a pattern",
    description:
      "Looks through the Live Set for tracks, devices, rack chains and Drum Rack pads whose path contains " +
      "every word of the pattern, in any order and ignoring case. One match is selected; several are shown " +
      "in a pick list. next and prev then step through the matches. Needs the cmdAbl Remote Script. " +
      "Unlike commands that act on a target, which need at least one word in the object's own name, find is a " +
      "search: it lists everything whose path contains the words, including what sits below a matching parent. " +
      "-L limits that: with -L n, an object is listed only if it, or an object at most n levels above it, has " +
      "one of the words in its own name — so -L 0 lists only the objects named like the pattern, -L 1 adds " +
      "their direct children, -L 2 their grandchildren. Without a pattern, find needs -L or one of -t, -d, -c " +
      "and lists from the top of the Set: with -L n, n levels below the Set (1 = top-level tracks, 2 = tracks and " +
      "their devices, and the tracks inside groups). The kind flags add up and narrow what is listed. find remembers its last list until " +
      "the extension restarts.",
    examples: [
      { line: "find kick", note: "everything with \"kick\" in its path" },
      { line: "find vermona -L 0", note: "only objects with \"vermona\" in their own name" },
      { line: "find vermona -L 1", note: "those, plus their direct children" },
      { line: "find -t", note: "all tracks" },
      { line: "find -L 2 -c kick", note: "chains and pads named like kick, at most two levels below a match" },
      { line: "find --unfold kick", note: "also show the track's chains in the Session mixer" },
    ],
    requires: ["bridge"],
    options: [
      {
        name: "level",
        short: "L",
        takesValue: true,
        number: { min: 0, max: 12, integer: true },
        summary: "how far below an object named like the pattern results go (0 = only those); without a pattern, levels below the Set",
      },
      { name: "tracks", short: "t", summary: "only tracks" },
      { name: "devices", short: "d", summary: "only devices" },
      { name: "chains", short: "c", summary: "only chains and drum pads" },
      { name: "unfold", summary: "also show the track's chains in the Session mixer when selecting (never folds anything)" },
    ],
    args: [
      {
        name: "pattern",
        kind: "text",
        required: false,
        rest: true,
        summary: "Words that must all occur in the path, in any order; optional with -L or a kind flag",
      },
    ],
    run: async (invocation): Promise<CommandResult | void> => {
      const pattern = String(invocation.args[0]?.[0] ?? "").trim();
      const levelText = invocation.options.level;
      const level = typeof levelText === "string" ? Number(levelText) : undefined;
      const kindFlag = invocation.options.tracks || invocation.options.devices || invocation.options.chains;
      if (pattern === "" && level === undefined && !kindFlag) {
        return fail(ExitCode.USAGE, "find: give a pattern, or -L, or a kind flag (-t, -d, -c)");
      }
      if (pattern === "" && level === 0) {
        return fail(ExitCode.USAGE, "find: without a pattern -L counts levels below the Set; use 1 or more");
      }
      const kinds = findKinds(invocation.options);
      const wantsUnfold = invocation.options.unfold === true;
      const all = liveNodes();
      const hits = findNodes(all, { pattern, level, kinds });
      const what = pattern === "" ? "" : ` "${pattern}"`;
      if (hits.length === 0) return fail(ExitCode.NOT_FOUND, `find: nothing matches${what}`);

      if (hits.length === 1) {
        matches.set([uniquePath(all, hits[0]!)], 0);
        unfold = wantsUnfold;
        return selectNodeResult(api.bridge, hits[0]!, { unfold });
      }
      const chosen = await api.pick(`find:${what} — ${hits.length} matches`, hits);
      unfold = wantsUnfold; // after the pick: its listener reset it
      if (chosen?.[0]) return selectNodeResult(api.bridge, chosen[0], { unfold });
    },
  });

  const stepCommand = (name: string, delta: 1 | -1, summary: string, description: string) =>
    api.commands.add({
      name,
      summary,
      description,
      examples: [{ line: name, note: summary }],
      requires: ["bridge"],
      run: async (): Promise<CommandResult> => {
        const entry = matches.step(delta);
        if (!entry) return fail(ExitCode.NOT_FOUND, `${name}: no matches to step through — run "find <pattern>" first`);
        const found = resolveStructural(liveNodes(), entry.path);
        if (found.length !== 1) return fail(ExitCode.NOT_FOUND, `${name}: "${entry.path}" is no longer there`);
        const outcome = await selectNodeResult(api.bridge, found[0]!, { unfold });
        // A failed select must not use up a step: go back so a re-run tries the same match.
        if (outcome.code !== 0) matches.step(delta === 1 ? -1 : 1);
        return outcome;
      },
    });
  stepCommand(
    "next",
    1,
    "go to the next match of the last find",
    "Selects the next object of the last find (or of the last pick list), wrapping around at the end. " +
      "Keeps the find's --unfold choice (a list from another pick steps without it). Needs the cmdAbl Remote Script. Without an earlier find there is nothing to step through.",
  );
  stepCommand(
    "prev",
    -1,
    "go to the previous match of the last find",
    "Selects the previous object of the last find (or of the last pick list), wrapping around at the start. " +
      "Keeps the find's --unfold choice (a list from another pick steps without it). Needs the cmdAbl Remote Script. Without an earlier find there is nothing to step through.",
  );
}
