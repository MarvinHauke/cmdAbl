import type { ModuleApi } from "../types.js";
import type { Command } from "../../core/command/commandRegistry.js";
import { resolveStructural, uniquePath } from "../../ableton/resolvePath.js";
import { selectNodeResult } from "../shared/selectNode.js";
import { ExitCode, fail, type CommandResult } from "../../core/types.js";
import { MatchList } from "./matches.js";
import { findKinds } from "./kinds.js";
import { findNodes } from "./select.js";
import { addTagMatches, describeTags, findTagged, splitPattern, unknownTags } from "./tagged.js";

/**
 * `find [pattern] [-L <n>] [-t] [-d] [-c]` — grep for the Live Set: every track/device/chain
 * whose path contains every word of the pattern (a search); `-L` limits how far below an
 * object whose own name matches the results go. One match is selected directly; several are
 * shown in the pick list. `find next` / `find prev` then step through the matches of the last
 * find (only that one — other pick lists don't replace it); `--first` / `--last` select the
 * first or last match without the pick list and keep the list for stepping.
 *
 * The only module that keeps state (the last match list) — in memory only.
 */
export function activate(api: ModuleApi): void {
  const matches = new MatchList();
  // `--unfold` of the `find` that made the list: `find next`/`find prev` keep it.
  let unfold = false;
  const liveNodes = () => api.liveSet.nodes();

  const search: Command = {
    name: "search",
    fallback: true,
    summary: "find tracks, devices and chains whose path contains a pattern",
    description:
      "Looks through the Live Set for tracks, devices, rack chains and Drum Rack pads whose path contains " +
      "every word of the pattern, in any order and ignoring case. One match is selected; several are shown " +
      "in a pick list; --first or --last selects the first or last match without the pick list. find next and find prev then step through the matches of the last find. Needs the cmdAbl Remote Script. " +
      "Unlike commands that act on a target, which need at least one word in the object's own name, find is a " +
      "search: it lists everything whose path contains the words, including what sits below a matching parent. " +
      "A word that is a tag name also finds the tracks tagged with it, and #drums restricts the search to the tracks " +
      "tagged drums (find #drums lists them, find #drums kick searches inside them); !#drums means the regular tracks " +
      "without that tag. " +
      "-L limits that: with -L n, an object is listed only if it, or an object at most n levels above it, has " +
      "one of the words in its own name — so -L 0 lists only the objects named like the pattern, -L 1 adds " +
      "their direct children, -L 2 their grandchildren. Without a pattern, find needs -L or one of -t, -d, -c " +
      "and lists from the top of the Set: with -L n, n levels below the Set (1 = top-level tracks, 2 = tracks and " +
      "their devices, and the tracks inside groups). The kind flags add up and narrow what is listed. find remembers its last list until " +
      "the extension restarts. The words next and prev at the start are the subcommands find next and find prev; to " +
      "search for an object named like that, put a flag first (find -t next) or another word before it (find kick next).",
    examples: [
      { line: "find 808", note: "everything with \"808\" in its path" },
      { line: "find 808 -L 0", note: "only objects with \"808\" in their own name" },
      { line: "find 808 -L 1", note: "those, plus their direct children" },
      { line: "find #drums", note: "every track tagged drums" },
      { line: "find #drums kick", note: "chains, pads and devices with \"kick\" in their path inside the tracks tagged drums" },
      { line: "find !#drums -t", note: "all regular tracks that are not tagged drums" },
      { line: "find -t", note: "all tracks" },
      { line: "find -c snare", note: "only chains and drum pads with \"snare\" in their path" },
      { line: "find -L 2 -c snare", note: "chains and pads named like snare, at most two levels below a match" },
      { line: "find --unfold snare", note: "also show the track's chains in the Session mixer" },
      { line: "find --first #drums", note: "select the first drums track, no pick list; find next steps on from there" },
      { line: "find --last #drums", note: "select the last drums track; find prev steps back" },
      { line: "find -t next", note: "a track named next (a flag first keeps the word a pattern)" },
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
      { name: "first", summary: "select the first match without the pick list; find next / find prev continue from it" },
      { name: "last", summary: "select the last match without the pick list; find next / find prev continue from it" },
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
      const wantsFirst = invocation.options.first === true;
      const wantsLast = invocation.options.last === true;
      if (wantsFirst && wantsLast) return fail(ExitCode.USAGE, "find: --first and --last exclude each other");
      const kinds = findKinds(invocation.options);
      const wantsUnfold = invocation.options.unfold === true;
      const { plain, tags } = splitPattern(pattern);

      // A `#tag` in the pattern reads the tags fresh from the Remote Script (and needs it); plain words
      // only add tracks from the cached tags, so they never wait for the script.
      if (tags.length > 0) {
        const fresh = await api.tags.refresh();
        if (!fresh.ok) return fail(fresh.code === 5 ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `find: ${fresh.text}`);
      }
      const all = liveNodes();
      const tagsOf = (n: (typeof all)[number]) => api.tags.of(n);
      const what = pattern === "" ? "" : ` "${pattern}"`;
      let hits;
      if (tags.length > 0) {
        const unknown = unknownTags(all, tags, tagsOf);
        if (unknown.length > 0) return fail(ExitCode.NOT_FOUND, `find: no track is tagged ${unknown.map((t) => `#${t.name}`).join(" ")}`);
        const tagged = findTagged(all, { plain, tags, level, kinds, kindFlag: Boolean(kindFlag), tagsOf });
        if (tagged.scope.length === 0) return fail(ExitCode.NOT_FOUND, `find: ${describeTags(tags)}`);
        hits = tagged.hits;
      } else {
        hits = addTagMatches(all, findNodes(all, { pattern, level, kinds }), plain, kinds, tagsOf);
      }
      if (hits.length === 0) return fail(ExitCode.NOT_FOUND, `find: nothing matches${what}`);

      const paths = hits.map((h) => uniquePath(all, h));
      if (hits.length === 1 || wantsFirst || wantsLast) {
        const index = wantsLast ? hits.length - 1 : 0;
        matches.set(paths, index);
        unfold = wantsUnfold;
        const outcome = await selectNodeResult(api.bridge, hits[index]!, { unfold });
        // Nothing selected yet: the list stays, but no entry counts as visited.
        if (outcome.code !== 0) matches.set(paths, -1);
        return outcome;
      }
      // `fill`: Tab puts the chosen object's path into the palette instead of
      // running; that resolves as a cancelled pick (null), which leaves the
      // find next/prev list as the cancel does: the new list, nothing visited.
      const chosen = await api.pick(`find:${what} — ${hits.length} matches`, hits, false, { fill: true });
      const current = chosen?.[0] ? hits.findIndex((n) => n.handleId === chosen[0]!.handleId) : -1;
      matches.set(paths, current);
      unfold = chosen?.[0] ? wantsUnfold : false; // a cancelled pick walks on without --unfold
      if (!chosen?.[0]) return;
      return selectNodeResult(api.bridge, chosen[0], { unfold });
    },
  };

  const stepCommand = (name: string, delta: 1 | -1, summary: string, description: string): Command => ({
    name,
    summary,
    description,
    examples: [{ line: `find ${name}`, note: summary }],
    requires: ["bridge"],
    run: async (): Promise<CommandResult> => {
      const label = `find ${name}`;
      const entry = matches.step(delta);
      if (!entry) return fail(ExitCode.NOT_FOUND, `${label}: no matches to step through — run "find <pattern>" first`);
      const found = resolveStructural(liveNodes(), entry.path);
      if (found.length !== 1) return fail(ExitCode.NOT_FOUND, `${label}: "${entry.path}" is no longer there`);
      const outcome = await selectNodeResult(api.bridge, found[0]!, { unfold });
      // A failed select must not use up a step: go back so a re-run tries the same match.
      if (outcome.code !== 0) matches.step(delta === 1 ? -1 : 1);
      return outcome;
    },
  });
  api.commands.add({
    name: "find",
    topic: "Find and select",
    summary: "find tracks, devices and chains whose path contains a pattern, and step through them",
    description:
      "find <pattern> searches the Live Set; find next and find prev step through the matches of the last find. " +
      "Only the last find is remembered (an ambiguous goto or a numbered pick doesn't replace it). " +
      "A subcommand word wins over a pattern word: to search for an object named next or prev, put a flag first (find -t next). " +
      "find search -h shows the options of the search (-L, -t, -d, -c, --unfold, --first, --last).",
    children: [
      search,
      stepCommand(
        "next",
        1,
        "go to the next match of the last find",
        "Selects the next object of the last find, wrapping around at the end. After find --first or --last it continues from that match. " +
          "Keeps the find's --unfold choice. Needs the cmdAbl Remote Script. Without an earlier find there is nothing to step through.",
      ),
      stepCommand(
        "prev",
        -1,
        "go to the previous match of the last find",
        "Selects the previous object of the last find, wrapping around at the start. After find --first or --last it continues from that match. " +
          "Keeps the find's --unfold choice. Needs the cmdAbl Remote Script. Without an earlier find there is nothing to step through.",
      ),
    ],
  });
}
