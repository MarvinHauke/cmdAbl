import type { ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import { quoteIfNeeded } from "./tokenize.js";
import { tagSuffix, type TagCount } from "./tags.js";
import type { PickPreview, StateChange, Ui } from "./ui.js";

// The pick list: shown by the platform whenever an address matches several
// objects. Whether more than one may be chosen is decided by the command's
// argument declaration (see resolveArgs.ts), never by the module. How it looks
// is up to the `select` surface (see ui.ts).

export interface PickOptions {
  title: string;
  candidates: ObjectNode[];
  multi: boolean;
  /** The whole Live Set, for unique paths; without it rows fall back to their own path. */
  nodes?: ObjectNode[];
  /** The command text around the address being picked for. */
  preview?: PickPreview;
  /** Row detail per candidate (which typed text it matched); default: the object's kind. */
  details?: string[];
  /** Single-select only: allow Tab to answer "fill" (the object goes into the prompt). */
  fill?: boolean;
  /** Current state per candidate (true on, false off, null unknown) and its name. */
  state?: { label: string; values: Array<boolean | null>; change?: StateChange };
}

export async function pickNodes(ui: Ui, options: PickOptions): Promise<ObjectNode[] | { fill: ObjectNode } | null> {
  const indexes = await ui.select({
    title: options.title,
    multi: options.multi,
    ...(options.preview ? { preview: options.preview } : {}),
    ...(options.fill && !options.multi ? { fill: true } : {}),
    ...(options.state?.values.some((v) => v !== null) ? { state: { label: options.state.label, ...(options.state.change ? { change: options.state.change } : {}) } } : {}),
    items: options.candidates.map((n, i) => {
      const label = options.nodes ? uniquePath(options.nodes, n) : n.path;
      const state = options.state?.values[i];
      return {
        label,
        detail: `${options.details?.[i] ?? n.kind}${tagSuffix(n)}`,
        value: quoteIfNeeded(label),
        ...(state === true ? { state: "on" as const } : state === false ? { state: "off" as const } : {}),
      };
    }),
  });
  if (!indexes) return null;
  if (!Array.isArray(indexes)) {
    const node = options.candidates[indexes.fill];
    return node ? { fill: node } : null;
  }
  const chosen = indexes.map((i) => options.candidates[i]).filter((n): n is ObjectNode => n !== undefined);
  return chosen.length ? chosen : null;
}

export interface PickTagsOptions {
  title: string;
  tags: TagCount[];
  multi: boolean;
  /** The command text around the `#` being picked for. */
  preview?: PickPreview;
}

/** The pick list of the Set's tags (a bare `#`): the chosen names, or null when cancelled. */
export async function pickTagNames(ui: Ui, options: PickTagsOptions): Promise<string[] | null> {
  const indexes = await ui.select({
    title: options.title,
    multi: options.multi,
    ...(options.preview ? { preview: options.preview } : {}),
    items: options.tags.map((t) => ({
      label: `#${t.name}`,
      detail: `${t.count} ${t.count === 1 ? "track" : "tracks"}`,
      value: `#${t.name}`,
    })),
  });
  if (!indexes || !Array.isArray(indexes)) return null;
  const chosen = indexes.map((i) => options.tags[i]?.name).filter((n): n is string => n !== undefined);
  return chosen.length ? chosen : null;
}
