import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem, PaletteResult } from "../types.js";
import { parseIndexes } from "./pickResult.js";
import promptTemplate from "../../ui/interface.html";
import selectTemplate from "../../ui/pick.html";
import notifyTemplate from "../../ui/feedback.html";

// The UI contract. The platform never touches an HTML file directly — it talks
// to three "surfaces", each defined only by the data it receives and the value
// it returns (the idea behind `vim.ui.select` / `vim.ui.input` in Neovim).
// The HTML files under ui/ are the default implementation and can be replaced
// without the core, the resolver or any module noticing
// (docs/feature-plans/0007-ui-surfaces.md).
//
// Everything crossing this boundary is plain JSON: an SDK dialog receives its
// data inlined into the page and can hand back exactly one string on close.

/** The command palette: type a line or pick an item. */
export interface PromptRequest {
  items: PaletteItem[];
}

/** The pick list: choose one (or, if `multi`, several) of the given rows. */
export interface SelectRequest {
  title: string;
  multi: boolean;
  items: { label: string; detail?: string }[];
}

/** A message for the user. `code` is the exit code it belongs to (0 = informational). */
export interface NotifyRequest {
  text: string;
  code: number;
}

export interface Ui {
  /** Resolves with what the user entered or picked, or null if they dismissed it. */
  prompt(request: PromptRequest): Promise<PaletteResult | null>;
  /** Resolves with the chosen indexes into `request.items`, or null if cancelled. */
  select(request: SelectRequest): Promise<number[] | null>;
  notify(request: NotifyRequest): void;
}

const dataUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

/** The built-in surfaces: SDK modal dialogs rendering the pages under ui/. */
export function createDefaultUi(context: ExtensionContext<"1.0.0">): Ui {
  return {
    async prompt(request) {
      const html = promptTemplate.replace("/*ITEMS_PLACEHOLDER*/null", () => JSON.stringify(request.items));
      const raw = await context.ui.showModalDialog(dataUrl(html), 500, 260);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as PaletteResult;
      } catch {
        console.error(`cmdAbl: malformed palette result: ${raw}`);
        return null;
      }
    },

    async select(request) {
      const html = selectTemplate.replace("/*PICK_PLACEHOLDER*/null", () => JSON.stringify(request));
      const height = Math.min(120 + request.items.length * 28, 420);
      const raw = await context.ui.showModalDialog(dataUrl(html), 560, height);
      return parseIndexes(raw, request.items.length);
    },

    notify(request) {
      const html = notifyTemplate.replace("/*MESSAGE_PLACEHOLDER*/null", () => JSON.stringify(request.text));
      void context.ui.showModalDialog(dataUrl(html), 500, 180);
    },
  };
}
