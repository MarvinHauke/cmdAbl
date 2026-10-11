import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { ObjectNode } from "../ableton/objectTree.js";
import pickTemplate from "../../ui/pick.html";
import { parsePickResult } from "./pickResult.js";

// The pick list: shown by the platform whenever an address matches several
// objects. Whether more than one may be chosen is decided by the command's
// argument declaration (see resolveArgs.ts), never by the module.

export interface PickOptions {
  title: string;
  candidates: ObjectNode[];
  multi: boolean;
}

export async function pickNodes(context: ExtensionContext<"1.0.0">, options: PickOptions): Promise<ObjectNode[] | null> {
  const payload = {
    title: options.title,
    multi: options.multi,
    items: options.candidates.map((n) => ({ label: n.path, detail: n.kind })),
  };
  const html = pickTemplate.replace("/*PICK_PLACEHOLDER*/null", () => JSON.stringify(payload));
  const height = Math.min(120 + options.candidates.length * 28, 420);
  const raw = await context.ui.showModalDialog(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, 560, height);
  return parsePickResult(raw, options.candidates);
}
