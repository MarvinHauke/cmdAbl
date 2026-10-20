import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../../core/types.js";
import { buildBoard, groupChanges } from "./board.js";
import { changed, diffTags, normalizeTagNames, planTags, reverseLines, tagIndex, type TagChange, type TagMode } from "./plan.js";

const SAVE_HINT = "Live was not told about the change: save the Set (Cmd+S) so the tags are kept.";

const hashed = (tags: string[]): string => (tags.length === 0 ? "no tags" : tags.map((t) => `#${t}`).join(" "));

/** The lines for one changed track: what changed, then the commands that put it back. */
export function changeLines(path: string, c: TagChange): string[] {
  const parts = [...c.added.map((t) => `+${t}`), ...c.removed.map((t) => `-${t}`)];
  return [`${path}: ${parts.join(" ")} (now ${hashed(c.after)})`, ...reverseLines(path, c).map((l) => `  undo: ${l}`)];
}

/**
 * `tag [--list] [--edit <tag|#>] [--set 1|0] <target> [name…]` — tags on tracks, kept in the Live Set
 * by the Remote Script. Toggles like mute; `--set` adds or removes.
 */
export function activate(api: ModuleApi): void {
  /** Writes `planFor(node, before)` to every target and builds the result: changed tracks with their undo lines. */
  const applyPlans = async (targets: ObjectNode[], planFor: (node: ObjectNode, before: string[]) => TagChange, stopOnFail = false, unchanged?: string): Promise<CommandResult> => {
    const lines: string[] = [];
    const outcomes: TargetOutcome[] = [];
    let unmarked = false;
    let writes = 0;
    for (const node of targets) {
      const before = api.tags.of(node);
      const plan = planFor(node, before);
      if (!changed(plan)) {
        lines.push(`${node.path}: no change (${hashed(before)})`);
        outcomes.push({ path: node.path, ok: true });
        continue;
      }
      const written = await api.tags.write(node, plan.after);
      if (!written.ok) {
        outcomes.push({ path: node.path, ok: false, code: written.code as never, message: written.text });
        if (stopOnFail) break;
        continue;
      }
      writes++;
      if (!written.value.marked) unmarked = true;
      const actual = diffTags(before, written.value.tags);
      const text = changeLines(node.path, actual);
      lines.push(...text);
      outcomes.push({ path: node.path, ok: true, message: text.join("\n") });
    }

    // Quiet writes (plan 0011): the change and undo lines go to the log; a result dialog opens only for a
    // failure (it lists the failed tracks) or for the one thing the user has to act on, the save hint.
    const log = lines;
    const failed = outcomes.filter((o) => !o.ok);
    // Nothing written at all would look like it worked: say so (a mix of changed and unchanged stays quiet).
    if (failed.length === 0 && writes === 0) return { ...ok(targets.length === 1 && unchanged ? unchanged : "nothing changed"), log };
    if (failed.length === 0) return { ...ok(unmarked ? SAVE_HINT : undefined), log };
    const code =
      failed.length === outcomes.length && failed.every((o) => o.code === ExitCode.UNAVAILABLE) ? ExitCode.UNAVAILABLE : ExitCode.FAILURE;
    return { ...fail(code, `tag: ${outcomes.length - failed.length} of ${outcomes.length} done${unmarked ? `\n${SAVE_HINT}` : ""}`, failed), log };
  };

  /**
   * `tag --list`: the board. Apply writes the changes per track and ends with the usual result (the changed
   * lines with their undo lines); Close or Esc changes nothing and says nothing. The board does not reopen.
   */
  const tagBoard = async (): Promise<CommandResult | void> => {
    const fresh = await api.tags.refresh();
    if (!fresh.ok) return fail(fresh.code === ExitCode.UNAVAILABLE ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `tag: ${fresh.text}`);
    const nodes = api.liveSet.nodes().filter((n) => n.kind === "track" && n.scope !== "master");
    const byId = new Map(nodes.map((n) => [n.handleId, n]));
    const shown = await api.ui.board(buildBoard(nodes.map((n) => ({ id: n.handleId, label: n.path, tags: api.tags.of(n) }))));
    if (!shown.answer || shown.answer.changes.length === 0) return;

    const { perTrack, bad } = groupChanges(shown.answer);
    if (bad !== undefined) return fail(ExitCode.USAGE, `tag: "${bad}" is not a tag name — use lowercase letters, digits, - and _`);
    const targets = [...perTrack.keys()].map((id) => byId.get(id)).filter((n): n is ObjectNode => n !== undefined);
    const result = await applyPlans(
      targets,
      (node, before) => {
        const change = perTrack.get(node.handleId)!;
        const added = planTags(before, change.add, "add").after;
        return diffTags(before, planTags(added, change.remove, "remove").after);
      },
      true,
    );
    if (result.code !== ExitCode.OK || !shown.cut) return result;
    return { ...result, log: [...(result.log ?? []), "(list cut: the board showed only part of the Set)"] };
  };

  /**
   * `tag --edit <tag|#>`: every regular and return track in the pick list, lit where it carries the tag;
   * Tab marks, Enter toggles the tag on the marked tracks, one by one.
   */
  const editTag = async (value: string, conflicting: boolean): Promise<CommandResult | void> => {
    if (conflicting) return fail(ExitCode.USAGE, "tag --edit takes only the tag: no target, names, --list or --set");
    let name: string | undefined;
    if (value !== "#") {
      const checked = normalizeTagNames([value]);
      if (!checked.ok || checked.names.length !== 1) {
        return fail(ExitCode.USAGE, `tag: "${value}" is not a tag name — use lowercase letters, digits, - and _`);
      }
      name = checked.names[0];
    }
    const fresh = await api.tags.refresh();
    if (!fresh.ok) return fail(fresh.code === ExitCode.UNAVAILABLE ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `tag: ${fresh.text}`);
    const nodes = api.liveSet.nodes();
    const tracks = nodes.filter((n) => n.kind === "track" && n.scope !== "master");

    if (name === undefined) {
      const rows = tagIndex(nodes.filter((n) => n.kind === "track").map((t) => ({ path: t.path, tags: api.tags.of(t) }))).map((e) => ({
        name: e.tag,
        count: e.paths.length,
      }));
      const chosen = await api.pickTags("tag --edit: which tag?", rows, { allowNew: true });
      if (!chosen || chosen.length === 0) return;
      if (chosen.length > 1) return fail(ExitCode.USAGE, "tag --edit works on one tag: mark only one");
      const checked = normalizeTagNames(chosen);
      if (!checked.ok || checked.names.length !== 1) {
        return fail(ExitCode.USAGE, `tag: "${chosen[0]}" is not a tag name — use lowercase letters, digits, - and _`);
      }
      name = checked.names[0]!;
    }
    const tag = name!;
    const picked = await api.pick(`tag --edit #${tag}`, tracks, true, {
      state: { label: `tagged ${tag}`, values: tracks.map((t) => api.tags.of(t).includes(tag)), change: "toggle" },
    });
    if (!picked || picked.length === 0) return;
    return applyPlans(picked, (_node, before) => planTags(before, [tag], "toggle"));
  };

  /**
   * `tag --rename <old> <new>`: the tag changes its name on every regular and return track that carries it.
   * A name that exists already merges (a track with both keeps one); that is the only visible message.
   */
  const renameTag = async (values: string[], conflicting: boolean): Promise<CommandResult | void> => {
    if (conflicting) return fail(ExitCode.USAGE, "tag --rename takes only the two names: no target, names, --list, --set, --edit or --pick");
    if (values.length !== 2) return fail(ExitCode.USAGE, "tag --rename needs <old> <new>");
    const names: string[] = [];
    for (const value of values) {
      const one = normalizeTagNames([value]);
      if (!one.ok) return fail(ExitCode.USAGE, `tag: "${value}" is not a tag name — use lowercase letters, digits, - and _`);
      names.push(one.names[0]!);
    }
    const [oldName, newName] = names as [string, string];
    const fresh = await api.tags.refresh();
    if (!fresh.ok) return fail(fresh.code === ExitCode.UNAVAILABLE ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `tag: ${fresh.text}`);
    const tracks = api.liveSet.nodes().filter((n) => n.kind === "track" && n.scope !== "master");
    const carrying = tracks.filter((t) => api.tags.of(t).includes(oldName));
    if (carrying.length === 0) return fail(ExitCode.NOT_FOUND, `tag: no track is tagged #${oldName}`);
    if (oldName === newName) return ok(`#${oldName} is already called that`);
    const merging = tracks.some((t) => api.tags.of(t).includes(newName));
    const result = await applyPlans(carrying, (_node, before) => {
      const after: string[] = [];
      for (const tag of before) {
        const next = tag === oldName ? newName : tag;
        if (!after.includes(next)) after.push(next);
      }
      return diffTags(before, after);
    });
    if (!merging || result.code !== ExitCode.OK) return result;
    return { ...result, message: [`merged #${oldName} into #${newName}`, result.message].filter(Boolean).join("\n") };
  };

  api.commands.add({
    name: "tag",
    summary: "tag tracks, or list the tags of the Set",
    description:
      "Tags say what a track is, so one command can act on a group: after tag /Lead fx the line mute #fx " +
      "reaches every track tagged fx. With --edit and a tag (tag --edit fx) every regular and return track is listed with a button " +
      "that is lit where it carries the tag: mark tracks with Tab and press Enter to switch the tag on or off on each of them; " +
      "tag --edit # first asks which tag, and a name that is not in that list creates it. With --rename and two names (tag --rename fx effects) the tag changes its name on every regular and return track that carries it, and writes nothing else; if the new name exists already the two tags merge, a track with both keeps one, and the result says so because renaming back cannot split them again. With --list, opens an overview: a section per tag with the tracks that carry it as chips with × to remove a track, an add… field that suggests the regular and return tracks to add, New tag… for a tag no track has yet, and a read-only list of the untagged tracks. Apply writes the changes and shows nothing; Close changes nothing. " +
      "With a target and no names, opens a list of the Set's tags: the buttons show which the target has, mark the ones to switch and press Enter. Type a name that is not in the list to get a row that creates it. With names, switches each tag on for a target " +
      "that lacks it and off for one that has it; --set 1 makes sure the tags are on, --set 0 that they are off. " +
      "Tags are lowercase letters, digits, - and _. They are stored in the Live Set by the cmdAbl Remote Script, " +
      "so the script has to run, and they are saved with the Set. Cmd+Z does not undo them. A successful write shows nothing: the changes and the undo commands go to the log, " +
      "and cmdabl log --undo lists the undo commands. Each track written leaves one invisible step in Live's undo list, so Cmd+Z may need several presses to get past them. The target is one word (quote a name with spaces), a path, or " +
      "a tag such as #drum; !#drum means every regular track without that tag, untagged ones included (never the main track).",
    examples: [
      { line: "tag --rename fx effects", note: "every track tagged fx is tagged effects instead; an existing effects tag merges" },
      { line: "tag --list", note: "the tag overview: add or remove tags on many tracks, create a tag" },
      { line: "tag --edit fx", note: "pick the tracks to switch the tag fx on or off for" },
      { line: "tag -e #", note: "pick the tag (or type a new one), then the tracks" },
      { line: "tag /Lead", note: "pick the tags to switch on or off for the track Lead, or type a new one" },
      { line: "tag /Lead fx synth", note: "switch fx and synth on, or off where they are on" },
      { line: "tag --set 1 /Bass fx", note: "make sure Bass is tagged fx" },
      { line: "tag --set 0 #drum fx", note: "remove fx from every track tagged drum" },
      { line: "tag --set 1 !#drums synth", note: "tag every track that is not a drums track as synth" },
    ],
    requires: ["bridge"],
    options: [
      {
        name: "edit",
        short: "e",
        takesValue: true,
        summary: "list the tracks with the tag lit and toggle the tag on the marked ones; # first asks which tag",
      },
      {
        name: "rename",
        short: "r",
        takesValue: true,
        values: 2,
        valueLabels: ["old", "new"],
        summary: "rename a tag on every track that carries it; an existing name merges",
      },
      { name: "list", short: "l", summary: "open the tag overview (add or remove tags on many tracks, create a tag) instead of changing tags" },
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
        required: false, // not required by the parser: --list takes none; the handler answers a missing one like the parser would
        summary: "A track (quote a name with spaces) or #tag for every track with that tag; without names a list of tags opens",
      },
      { name: "name", kind: "text", required: false, variadic: true, summary: "Tag names: lowercase letters, digits, - and _" },
    ],
    run: async (invocation): Promise<CommandResult | void> => {
      const targets = (invocation.args[0] ?? []) as ObjectNode[];
      const words = (invocation.args[1] ?? []) as string[];

      const renameValues = invocation.values?.rename;
      if (renameValues !== undefined) {
        return renameTag(renameValues, targets.length > 0 || words.length > 0 || invocation.options.list === true || invocation.options.set !== undefined || invocation.options.edit !== undefined || invocation.options.pick === true);
      }
      const listing = invocation.options.list === true;
      const edit = typeof invocation.options.edit === "string" ? invocation.options.edit.trim() : undefined;
      if (edit !== undefined) return editTag(edit, targets.length > 0 || words.length > 0 || listing || invocation.options.set !== undefined);
      if (listing && (targets.length > 0 || words.length > 0 || invocation.options.set !== undefined)) {
        return fail(ExitCode.USAGE, "tag --list takes no target, names or --set");
      }
      if (!listing && targets.length === 0) {
        // Same answer as the platform gives for a missing argument: exit 2 with the usage.
        return fail(ExitCode.USAGE, `missing argument <target>\n${api.commands.usage(["tag"]) ?? "usage: tag [--set <0|1>] <target> [<name>…]"}`);
      }

      const fresh = await api.tags.refresh();
      if (!fresh.ok) return fail(fresh.code === ExitCode.UNAVAILABLE ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `tag: ${fresh.text}`);
      const tracks = api.liveSet.nodes().filter((n) => n.kind === "track");
      const set = invocation.options.set;
      const mode: TagMode = set === "1" ? "add" : set === "0" ? "remove" : "toggle";

      if (listing) return tagBoard();

      let pickedModes: Map<string, TagMode> | null = null;
      let pickedRows: Array<{ name: string; on: boolean }> | null = null;
      if (words.length === 0) {
        // The Set's tags as a list; the state buttons show what the target(s) have, Enter applies the marked ones.
        const index = tagIndex(tracks.map((t) => ({ path: t.path, tags: api.tags.of(t) })));
        const rows = index.map((e) => ({
          name: e.tag,
          count: e.paths.length,
          on: targets.every((t) => api.tags.of(t).includes(e.tag)),
        }));
        const title = `tag ${targets.length === 1 ? targets[0]!.path : `${targets.length} tracks`}`;
        const chosen = await api.pickTags(title, rows, {
          change: mode === "add" ? "on" : mode === "remove" ? "off" : "toggle",
          allowNew: true,
        });
        // The created name, if any, comes last as typed; it is checked below like a typed one.
        if (!chosen || chosen.length === 0) return;
        words.push(...chosen);
        pickedRows = rows;
      }

      const names = normalizeTagNames(words);
      if (!names.ok) {
        return fail(ExitCode.USAGE, `tag: "${names.bad}" is not a tag name — use lowercase letters, digits, - and _`);
      }
      // The list promised one result per row: a lit row is removed from every target, any other (a created
      // name included) added to every target (a per-track toggle would flip tracks that disagree the wrong way round).
      if (pickedRows && mode === "toggle") {
        const rows = pickedRows;
        pickedModes = new Map(names.names.map((n) => [n, rows.find((r) => r.name === n)?.on ? "remove" : "add"]));
      }

      const listed = names.names.map((n) => `#${n}`).join(" ");
      const unchanged = mode === "add" ? `${targets[0]!.path} already has ${listed}` : mode === "remove" ? `${targets[0]!.path} has no ${listed}` : undefined;
      return applyPlans(targets, (_node, before) =>
        pickedModes
          ? diffTags(
              before,
              planTags(
                planTags(before, names.names.filter((n) => pickedModes!.get(n) === "add"), "add").after,
                names.names.filter((n) => pickedModes!.get(n) === "remove"),
                "remove",
              ).after,
            )
          : planTags(before, names.names, mode),
        false,
        unchanged,
      );
    },
  });
}
