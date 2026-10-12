import type { ObjectNode } from "../ableton/objectTree.js";
import { uniquePath } from "../ableton/resolvePath.js";
import { quoteIfNeeded } from "./tokenize.js";
import type { PickPreview, Ui } from "./ui.js";

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
}

export async function pickNodes(ui: Ui, options: PickOptions): Promise<ObjectNode[] | null> {
  const indexes = await ui.select({
    title: options.title,
    multi: options.multi,
    ...(options.preview ? { preview: options.preview } : {}),
    items: options.candidates.map((n, i) => {
      const label = options.nodes ? uniquePath(options.nodes, n) : n.path;
      return { label, detail: options.details?.[i] ?? n.kind, value: quoteIfNeeded(label) };
    }),
  });
  if (!indexes) return null;
  const chosen = indexes.map((i) => options.candidates[i]).filter((n): n is ObjectNode => n !== undefined);
  return chosen.length ? chosen : null;
}
