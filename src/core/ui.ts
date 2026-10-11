import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem, PaletteResult } from "../types.js";
import { parseIndexes } from "./pickResult.js";
import { createDialogQueue, type DialogQueue } from "./dialogQueue.js";
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
  /**
   * The command text around the address being resolved, so the page can show
   * the line Enter will run: `before`, the `value`s of the marked rows, `after`,
   * joined with one space (empty parts skipped). Values go in the order of the
   * returned indexes; with nothing marked the active row's value is shown.
   * Absent: show no line.
   */
  preview?: PickPreview;
  items: {
    /** The row's text (for a pick: the unique path, unquoted). */
    label: string;
    detail?: string;
    /** What this row contributes to the line (for a pick: the quoted unique path). */
    value?: string;
  }[];
}

export interface PickPreview {
  before: string;
  after: string;
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

/** JSON for inlining into a <script> block: `<` is escaped so a name like `</script>` cannot end it. */
const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

const dataUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

/**
 * The built-in surfaces: SDK modal dialogs rendering the pages under ui/.
 * Every dialog goes through `queue`, so only one is ever open; a dialog that
 * fails to open counts as dismissed (nothing throws at a user action).
 */
export function createDefaultUi(
  context: ExtensionContext<"1.0.0">,
  queue: DialogQueue = createDialogQueue(),
): Ui {
  const show = (name: string, html: string, width: number, height: number): Promise<string | null> =>
    // A failure is already logged by the queue; here it only counts as dismissed.
    queue.run(name, () => context.ui.showModalDialog(dataUrl(html), width, height)).catch(() => null);

  return {
    async prompt(request) {
      const html = promptTemplate.replace("/*ITEMS_PLACEHOLDER*/null", () => inlineJson(request.items));
      const raw = await show("palette", html, 500, 260);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as PaletteResult;
      } catch {
        console.error(`cmdAbl: malformed palette result: ${raw}`);
        return null;
      }
    },

    async select(request) {
      const html = selectTemplate.replace("/*PICK_PLACEHOLDER*/null", () => inlineJson(request));
      const height = Math.min(120 + request.items.length * 28, 420);
      const raw = await show("pick", html, 560, height);
      return parseIndexes(raw, request.items.length);
    },

    notify(request) {
      const html = notifyTemplate.replace("/*MESSAGE_PLACEHOLDER*/null", () => inlineJson(request.text));
      void show("message", html, 500, 180);
    },
  };
}
