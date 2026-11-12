import type { ModuleApi } from "../types.js";
import type { ObjectNode } from "../../ableton/objectTree.js";
import { ExitCode, fail, ok, type CommandResult, type TargetOutcome } from "../../core/types.js";
import { fillTemplate } from "../../core/surfaces/inlineJson.js";
import { buildEditor, finalTags, mergesOf, parseAnswer, type EditorTrack } from "./editor.js";
import { listEnterLine, listRows } from "./list.js";
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
export function activate(api: ModuleApi, tagEditorTemplate: string): void {
  // The Set's tags for `--edit` and `--rename`: read from the tag cache (the platform refreshes it when the palette opens).
  api.commands.completer("tags", () =>
    tagIndex(api.liveSet.nodes().filter((n) => n.kind === "track").map((t) => ({ path: t.path, tags: api.tags.of(t) }))).map((e) => ({
      label: e.tag,
      description: `${e.paths.length} track${e.paths.length === 1 ? "" : "s"}`,
    })),
  );

  /** Writes `planFor(node, before)` to every target and builds the result: changed tracks with their undo lines. */
  const applyPlans = async (targets: ObjectNode[], planFor: (node: ObjectNode, before: string[]) => TagChange, stopOnFail = false, unchanged?: string, summary?: (writes: number) => string[]): Promise<CommandResult> => {
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
    if (failed.length === 0) {
      const text = [...(summary?.(writes) ?? []), ...(unmarked ? [SAVE_HINT] : [])].join("\n");
      return { ...ok(text || undefined), log };
    }
    const code =
      failed.length === outcomes.length && failed.every((o) => o.code === ExitCode.UNAVAILABLE) ? ExitCode.UNAVAILABLE : ExitCode.FAILURE;
    return { ...fail(code, `tag: ${outcomes.length - failed.length} of ${outcomes.length} done${unmarked ? `\n${SAVE_HINT}` : ""}`, failed), log };
  };

  const regularTracks = (): ObjectNode[] => api.liveSet.nodes().filter((n) => n.kind === "track" && n.scope !== "master");

  /** `tag --list`: a read-only list, one row per tag; Enter on a tag row runs the setting `tag.listEnter`. */
  const tagList = async (): Promise<CommandResult | void> => {
    const fresh = await api.tags.refresh();
    if (!fresh.ok) return fail(fresh.code === ExitCode.UNAVAILABLE ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `tag: ${fresh.text}`);
    const tracks = regularTracks();
    if (tracks.length === 0) return ok("tag: the Set has no tracks");
    const tracksOf = tracks.map((t) => ({ name: t.name, path: t.path, tags: api.tags.of(t) }));
    const rows = listRows(tracksOf);
    const index = await api.pickRows("tag --list", rows.map((r) => ({ label: r.label, detail: r.detail, disabled: r.tag === undefined })));
    const row = index === null ? undefined : rows[index];
    if (!row || row.tag === undefined) return;
    const template = await api.settings.get<string>("listEnter");
    return { ...ok(), run: listEnterLine(template, row.tag) } as CommandResult;
  };

  /**
   * `tag --edit [tag]` and `tag <target>` without names: the tag editor page. The answer is validated against the
   * request; Apply writes per track (renames, then removals, then the set) and ends with the usual result.
   */
  const tagEditor = async (focus: { tag?: string; track?: ObjectNode }): Promise<CommandResult | void> => {
    const fresh = await api.tags.refresh();
    if (!fresh.ok) return fail(fresh.code === ExitCode.UNAVAILABLE ? ExitCode.UNAVAILABLE : ExitCode.FAILURE, `tag: ${fresh.text}`);
    const nodes = regularTracks();
    const tracks: EditorTrack[] = nodes.map((n) => {
      const segments = n.path.split("/").filter(Boolean);
      const group = segments.length > 1 ? segments[segments.length - 2] : undefined;
      return { id: n.handleId, name: n.name, ...(group !== undefined ? { group } : {}), tags: api.tags.of(n) };
    });
    const view = (await api.settings.get<string>("editView")) === "grid" ? "grid" : "list";
    const filter = (await api.settings.get<string>("filter")) === "highlight" ? "highlight" : "compact";
    const request = buildEditor(tracks, {
      view,
      filter,
      ...(focus.tag !== undefined ? { focusTag: focus.tag } : {}),
      ...(focus.track ? { focusTrack: focus.track.handleId } : {}),
    });
    let html: string;
    try {
      html = fillTemplate(tagEditorTemplate, { TAG_EDITOR: request });
      if (html === tagEditorTemplate) throw new Error("the page has no TAG_EDITOR placeholder");
    } catch (e: unknown) {
      return fail(ExitCode.FAILURE, `tag: cannot build the editor page — ${e instanceof Error ? e.message : String(e)}`);
    }
    const answer = await api.dialog(html, 760, 560, "tag editor", { gear: true });
    const parsed = parseAnswer(answer, request);
    if (parsed.kind === "closed" || parsed.kind === "settings") return;
    if (parsed.kind === "error") return fail(ExitCode.USAGE, parsed.message);

    const { edits } = parsed;
    const after = (node: ObjectNode, before: string[]): string[] => finalTags(before, node.handleId, edits);
    const targets = nodes.filter((n) => {
      const before = api.tags.of(n);
      const d = diffTags(before, after(n, before));
      return d.added.length + d.removed.length > 0;
    });
    if (targets.length === 0) return ok("nothing changed");
    const merges = mergesOf(tracks, edits).map(([from, to]) => `merged #${from} into #${to}`);
    return applyPlans(targets, (node, before) => diffTags(before, after(node, before)), true, undefined, (writes) => [
      ...merges,
      `${writes} ${writes === 1 ? "track" : "tracks"} changed (one undo step per track)`,
    ]);
  };

  /** `tag --edit [tag]`: the editor, opened on the tag (a new name starts an empty tag) or on the first tag. */
  const editTagCommand = async (value: string, conflicting: boolean): Promise<CommandResult | void> => {
    if (conflicting) return fail(ExitCode.USAGE, "tag --edit takes only the tag: no target, names, --list or --set");
    if (value === "" || value === "#") return tagEditor({});
    const checked = normalizeTagNames([value]);
    if (!checked.ok || checked.names.length !== 1) {
      return fail(ExitCode.USAGE, `tag: "${value}" is not a tag name — use lowercase letters, digits, - and _`);
    }
    return tagEditor({ tag: checked.names[0]! });
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
    topic: "Tags",
    summary: "tag tracks, list the tags, or edit them",
    description:
      "Tags say what a track is, so one command can act on a group: after tag /Lead fx the line mute #fx " +
      "reaches every track tagged fx. With --list, a read-only list shows one row per tag with its track count and track names, " +
      "and the untagged tracks as a last row that cannot be picked; Enter on a tag runs the setting tag.listEnter with {} replaced by the tag " +
      "(default find #{}, so find next and find prev step through those tracks). With --edit (tag --edit fx), the tag editor opens: " +
      "the tags with the tracks that carry them, check boxes to switch tags on and off, F2 to rename a tag (an existing name merges), " +
      "Shift+Backspace to remove a tag from every track, and a new tag. Nothing is written until Apply; Esc closes without changes. " +
      "tag --edit without a tag opens on the first tag, a name that does not exist yet starts a new tag; the settings tag.editView (list or grid) and tag.filter " +
      "(compact or highlight) choose how it opens and filters. With a target and no names the editor opens with that track in focus. " +
      "With --rename and two names (tag --rename fx effects) the tag changes its name on every regular and return track that carries it, and writes nothing else; " +
      "if the new name exists already the two tags merge, a track with both keeps one, and the result says so because renaming back cannot split them again. " +
      "With names, switches each tag on for a target that lacks it and off for one that has it; --set 1 makes sure the tags are on, --set 0 that they are off. " +
      "Tags are lowercase letters, digits, - and _. They are stored in the Live Set by the cmdAbl Remote Script, " +
      "so the script has to run, and they are saved with the Set. Cmd+Z does not undo them. A quiet write shows nothing: the changes and the undo commands go to the log, " +
      "and cmdabl log --undo lists the undo commands; the editor's Apply says how many tracks changed. Each track written leaves one invisible step in Live's undo list, so Cmd+Z may need several presses to get past them. The target is one word (quote a name with spaces), a path, or " +
      "a tag such as #drum; !#drum means every regular track without that tag, untagged ones included (never the main track).",
    examples: [
      { line: "tag --rename fx effects", note: "every track tagged fx is tagged effects instead; an existing effects tag merges" },
      { line: "tag --list", note: "the tags of the Set with their tracks; Enter runs tag.listEnter (default find #fx)" },
      { line: "tag --edit fx", note: "open the tag editor on the tag fx" },
      { line: "tag -e", note: "open the tag editor on the first tag" },
      { line: "tag /Lead", note: "open the tag editor with the track Lead in focus" },
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
        complete: "tags",
        valueLabels: ["tag|#"],
        valueDefault: "#",
        summary: "open the tag editor on a tag (a new name starts one); without a tag on the first tag",
      },
      {
        name: "rename",
        short: "r",
        takesValue: true,
        complete: "tags",
        values: 2,
        valueLabels: ["old", "new"],
        summary: "rename a tag on every track that carries it; an existing name merges",
      },
      { name: "list", short: "l", summary: "list the tags with their tracks (read-only); Enter runs tag.listEnter" },
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
        summary: "A track (quote a name with spaces) or #tag for every track with that tag; without names the tag editor opens",
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
      if (edit !== undefined) return editTagCommand(edit, targets.length > 0 || words.length > 0 || listing || invocation.options.set !== undefined);
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

      if (listing) return tagList();

      if (words.length === 0) {
        if (invocation.options.set !== undefined) return fail(ExitCode.USAGE, "tag --set needs tag names");
        // One track: the editor opens with it in focus; several targets (#tag) open it without a track focus.
        return tagEditor(targets.length === 1 ? { track: targets[0] } : {});
      }

      const names = normalizeTagNames(words);
      if (!names.ok) {
        return fail(ExitCode.USAGE, `tag: "${names.bad}" is not a tag name — use lowercase letters, digits, - and _`);
      }
      const listed = names.names.map((n) => `#${n}`).join(" ");
      const unchanged = mode === "add" ? `${targets[0]!.path} already has ${listed}` : mode === "remove" ? `${targets[0]!.path} has no ${listed}` : undefined;
      return applyPlans(targets, (_node, before) => planTags(before, names.names, mode), false, unchanged);
    },
  });
  // Declared after the first commands.add so the key's namespace is the module's name (`tag`).
  api.settings.declare({
    heading: "Tags",
    items: [
      {
        key: "tag.listEnter",
        label: "Enter in the tag list",
        help: "What Enter on a tag in tag --list runs; {} is the tag. find #{} steps through the tracks with find next / find prev.",
        kind: "enum",
        default: "find #{}",
        choices: [
          { value: "find #{}", label: "find #{}" },
          { value: "tag -e {}", label: "tag -e {}" },
          { value: "mute #{}", label: "mute #{}" },
          { value: "solo #{}", label: "solo #{}" },
        ],
      },
      {
        key: "tag.editView",
        label: "Tag editor view",
        help: "Which view tag --edit opens: two panes (tags and their tracks) or a grid (tracks by tags). Ctrl+G switches in the page.",
        kind: "enum",
        default: "list",
        choices: [
          { value: "list", label: "List" },
          { value: "grid", label: "Grid" },
        ],
      },
      {
        key: "tag.filter",
        label: "Tag editor filter",
        help: "Typing in the tag editor hides what does not match (compact) or keeps everything and skips the rows that do not match (highlight).",
        kind: "enum",
        default: "compact",
        choices: [
          { value: "compact", label: "Compact" },
          { value: "highlight", label: "Highlight" },
        ],
      },
    ],
  });
}
