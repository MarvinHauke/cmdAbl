import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem, PaletteResult } from "./types.js";
import { parseSelectAnswer } from "./pickResult.js";
import { notifySize } from "./notifySize.js";
import { pickHeight, pickWidth } from "./pickSize.js";
import { inlineJson } from "./inlineJson.js";
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
  /**
   * Open with this text in the input and the caret at `cursor` (0 = at the
   * start): used when a pick list's Tab put an object into the prompt, e.g.
   * ` "/Vermona MIDI/Drum Rack/Kick"` so the user types the command before it.
   * Absent: an empty prompt.
   */
  initial?: { text: string; cursor: number };
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
  /**
   * Single-select only: Tab on a row answers `{ fill: index }` instead of
   * confirming — the platform then puts the row's object into the prompt. The
   * page offers it only when this is true and `multi` is false (multi-select
   * keeps Tab = mark).
   */
  fill?: boolean;
  /**
   * Names the state the rows' `state` shows ("muted", "soloed", "armed"):
   * present only when at least one row has a state. The page draws `●` for on
   * and `○` for off before the label and names the state once (hint or header),
   * so the meaning does not depend on colour. Rows without `state` show no symbol.
   */
  state?: { label: string };
  items: {
    /** The row's text (for a pick: the unique path, unquoted). */
    label: string;
    detail?: string;
    /** What this row contributes to the line (for a pick: the quoted unique path). */
    value?: string;
    /** The row's current state (see `SelectRequest.state`); absent = unknown. */
    state?: "on" | "off";
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
  /**
   * Resolves with the chosen indexes into `request.items`, `{ fill: index }`
   * when the user pressed Tab on a list that allows it, or null if cancelled.
   */
  select(request: SelectRequest): Promise<number[] | { fill: number } | null>;
  notify(request: NotifyRequest): void;
  /** A module's own page: resolves with the string it returns on close, or null if dismissed (an empty string counts as dismissed). */
  page(name: string, html: string, width: number, height: number): Promise<string | null>;
}

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
      const html = promptTemplate
        .replace("/*ITEMS_PLACEHOLDER*/null", () => inlineJson(request.items))
        .replace("/*INITIAL_PLACEHOLDER*/null", () => inlineJson(request.initial ?? null));
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
      const height = pickHeight(request.items.length, request.preview !== undefined);
      const longest = (texts: Array<string | undefined>) => texts.reduce((m, t) => Math.max(m, t?.length ?? 0), 0);
      const width = pickWidth(longest(request.items.map((i) => i.label)), longest(request.items.map((i) => i.detail)));
      const raw = await show("pick", html, width, height);
      const answer = parseSelectAnswer(raw, request.items.length);
      // A page that answers "fill" where it was not offered is treated as cancelled.
      if (answer && !Array.isArray(answer) && !(request.fill && !request.multi)) return null;
      return answer;
    },

    notify(request) {
      const html = notifyTemplate.replace("/*MESSAGE_PLACEHOLDER*/null", () => inlineJson(request.text));
      const { width, height } = notifySize(request.text);
      void show("message", html, width, height);
    },

    async page(name, html, width, height) {
      // The SDK resolves an empty string on dismissal: both count as dismissed.
      return (await show(name, html, width, height)) || null;
    },
  };
}
