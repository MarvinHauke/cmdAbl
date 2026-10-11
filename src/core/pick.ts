import type { ObjectNode } from "../ableton/objectTree.js";
import type { Ui } from "./ui.js";

// The pick list: shown by the platform whenever an address matches several
// objects. Whether more than one may be chosen is decided by the command's
// argument declaration (see resolveArgs.ts), never by the module. How it looks
// is up to the `select` surface (see ui.ts).

export interface PickOptions {
  title: string;
  candidates: ObjectNode[];
  multi: boolean;
}

export async function pickNodes(ui: Ui, options: PickOptions): Promise<ObjectNode[] | null> {
  const indexes = await ui.select({
    title: options.title,
    multi: options.multi,
    items: options.candidates.map((n) => ({ label: n.path, detail: n.kind })),
  });
  if (!indexes) return null;
  const chosen = indexes.map((i) => options.candidates[i]).filter((n): n is ObjectNode => n !== undefined);
  return chosen.length ? chosen : null;
}
