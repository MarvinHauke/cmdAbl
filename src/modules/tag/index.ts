import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../../core/types.js";
import { changed, diffTags, normalizeTagNames, planTags, reverseLines, tagIndex, type TagChange, type TagMode } from "./plan.js";

const hashed = (tags: string[]): string => (tags.length === 0 ? "no tags" : tags.map((t) => `#${t}`).join(" "));

/** The lines for one changed track: what changed, then the commands that put it back. */
export function changeLines(path: string, c: TagChange): string[] {
  const parts = [...c.added.map((t) => `+${t}`), ...c.removed.map((t) => `-${t}`)];
  return [`${path}: ${parts.join(" ")} (now ${hashed(c.after)})`, ...reverseLines(path, c).map((l) => `  undo: ${l}`)];
}

/**
 * `tag [--set 1|0] [<target> [name…]]` — tags on tracks, kept in the Live Set
 * by the Remote Script. Toggles like mute; `--set` adds or removes.
 */
export function activate(api: ModuleApi): void {
  api.commands.add({
    name: "tag",
    summary: "tag tracks, or list the tags of the Set",
    description:
      "Tags say what a track is, so one command can act on a group: after tag /Lead fx the line mute #fx " +
      "reaches every track tagged fx. Without arguments, lists every tag and the tracks that carry it. " +
      "With a target and no names, opens a list of the Set's tags: the buttons show which the target has, mark the ones to switch and press Enter. With names, switches each tag on for a target " +
      "that lacks it and off for one that has it; --set 1 makes sure the tags are on, --set 0 that they are off. " +
      "Tags are lowercase letters, digits, - and _. They are stored in the Live Set by the cmdAbl Remote Script, " +
      "so the script has to run, and they are saved with the Set. Cmd+Z does not undo them: the result names " +
      "the command that puts every change back. Each track written leaves one invisible step in Live's undo list, so Cmd+Z may need several presses to get past them. The target is one word (quote a name with spaces), a path, or " +
      "a tag such as #drum; !#drum means every regular track without that tag, untagged ones included (never the main track).",
    examples: [
      { line: "tag", note: "all tags and their tracks" },
      { line: "tag /Lead", note: "pick the tags to switch on or off for the track Lead" },
      { line: "tag /Lead fx synth", note: "switch fx and synth on, or off where they are on" },
      { line: "tag --set 1 /Bass fx", note: "make sure Bass is tagged fx" },
      { line: "tag --set 0 #drum fx", note: "remove fx from every track tagged drum" },
      { line: "tag --set 1 !#drums synth", note: "tag every track that is not a drums track as synth" },
    ],
    requires: ["bridge"],
    options: [
      {
        name: "set",
        short: "s",
        takesValue: true,
        choices: ["0", "1"],
        summary: "make sure every target has the tags (1) or lacks them (0) instead of toggling",
      },
    ],
    args: [
      {
        name: "target",
        kind: "path",
        kinds: ["track"],
        required: false,
        summary: "A track (quote a name with spaces) or #tag for every track with that tag; without names a list of tags opens",
      },
      { name: "name", kind: "text", required: false, variadic: true, summary: "Tag names: lowercase letters, digits, - and _" },
    ],
    run: async (invocation): Promise<CommandResult | void> => {
      const targets = (invocation.args[0] ?? []) as ObjectNode[];
      const words = (invocation.args[1] ?? []) as string[];

      const fresh = await api.tags.refresh();
      if (!fresh.ok) return fail(fresh.code === 5 ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `tag: ${fresh.text}`);
      const tracks = api.liveSet.nodes().filter((n) => n.kind === "track");
      const set = invocation.options.set;
      const mode: TagMode = set === "1" ? "add" : set === "0" ? "remove" : "toggle";

      if (targets.length === 0) {
        const index = tagIndex(tracks.map((t) => ({ path: t.path, tags: api.tags.of(t) })));
        if (index.length === 0) return ok("no tags in the Set");
        return ok(index.map((e) => `#${e.tag}: ${e.paths.join(", ")}`).join("\n"));
      }

      let pickedModes: Map<string, TagMode> | null = null;
      if (words.length === 0) {
        // The Set's tags as a list; the state buttons show what the target(s) have, Enter applies the marked ones.
        const index = tagIndex(tracks.map((t) => ({ path: t.path, tags: api.tags.of(t) })));
        if (index.length === 0) return ok("no tags in the Set — name one to create it: tag <target> <name>");
        const rows = index.map((e) => ({
          name: e.tag,
          count: e.paths.length,
          on: targets.every((t) => api.tags.of(t).includes(e.tag)),
        }));
        const title = `tag ${targets.length === 1 ? targets[0]!.path : `${targets.length} tracks`}`;
        const chosen = await api.pickTags(title, rows, { change: mode === "add" ? "on" : mode === "remove" ? "off" : "toggle" });
        if (!chosen || chosen.length === 0) return;
        words.push(...chosen);
        // The list promised one result per row: a lit row is removed from every target, any other added to
        // every target (a per-track toggle would flip tracks that disagree the wrong way round).
        if (mode === "toggle") pickedModes = new Map(chosen.map((n) => [n, rows.find((r) => r.name === n)?.on ? "remove" : "add"]));
      }

      const names = normalizeTagNames(words);
      if (!names.ok) {
        return fail(ExitCode.USAGE, `tag: "${names.bad}" is not a tag name — use lowercase letters, digits, - and _`);
      }

      const lines: string[] = [];
      const outcomes: TargetOutcome[] = [];
      let unmarked = false;
      for (const node of targets) {
        const before = api.tags.of(node);
        const plan = pickedModes
          ? diffTags(
              before,
              planTags(
                planTags(before, names.names.filter((n) => pickedModes!.get(n) === "add"), "add").after,
                names.names.filter((n) => pickedModes!.get(n) === "remove"),
                "remove",
              ).after,
            )
          : planTags(before, names.names, mode);
        if (!changed(plan)) {
          lines.push(`${node.path}: no change (${hashed(before)})`);
          outcomes.push({ path: node.path, ok: true });
          continue;
        }
        const written = await api.tags.write(node, plan.after);
        if (!written.ok) {
          outcomes.push({ path: node.path, ok: false, code: written.code as never, message: written.text });
          continue;
        }
        if (!written.value.marked) unmarked = true;
        const actual = diffTags(before, written.value.tags);
        const text = changeLines(node.path, actual);
        lines.push(...text);
        outcomes.push({ path: node.path, ok: true, message: text.join("\n") });
      }
      if (unmarked) lines.push("Live was not told about the change: save the Set (Cmd+S) so the tags are kept.");

      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length === 0) return ok(lines.join("\n"));
      const code =
        failed.length === outcomes.length && failed.every((o) => o.code === ExitCode.UNAVAILABLE) ? ExitCode.UNAVAILABLE : ExitCode.FAILURE;
      return fail(code, `tag: ${outcomes.length - failed.length} of ${outcomes.length} done`, outcomes);
    },
  });
}
