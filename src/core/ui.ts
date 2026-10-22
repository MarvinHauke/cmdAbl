import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem, PaletteResult, ResultSection } from "./types.js";
import type { CompletionData } from "./complete.js";
import { PALETTE_WIDTH, paletteHeight } from "./paletteSize.js";
import { takePaletteAnswer, type PaletteSettings } from "./settings.js";
import { parseSelectAnswer } from "./pickResult.js";
import { notifySize, sectionsText } from "./notifySize.js";
import { boardSize, parseBoardAnswer } from "./board.js";
import { pickHeight, pickWidth } from "./pickSize.js";
import { logger } from "./log.js";
import { fillTemplate } from "./inlineJson.js";
import { createDialogQueue, type DialogQueue } from "./dialogQueue.js";
import promptTemplate from "../../ui/interface.html";
import selectTemplate from "../../ui/pick.html";
import { openUrl } from "./openUrl.js";
import { wantsOpen } from "./pickResult.js";
import notifyTemplate from "../../ui/feedback.html";
import boardTemplate from "../../ui/board.html";

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
   * The snapshot the page completes arguments from (plan 0006): the command tree, module completer
   * rows, the Set's paths and tags. Plain JSON; the page runs `CmdComplete.complete(line, cursor, completion)`.
   * Absent: the page offers no argument completion.
   */
  completion?: CompletionData;
  /**
   * The palette's stored settings (plan 0006 "Two zones"), for the page to start with. The page returns
   * changed settings in `PaletteResult.settings` (see `createDefaultUi`'s `onSettings`).
   */
  settings?: PaletteSettings;
  /**
   * Open with this text in the input and the caret at `cursor` (0 = at the
   * start): used when a pick list's Tab put an object into the prompt, e.g.
   * ` "/2-808 Core Kit/808 Core Kit/Snare Drum"` so the user types the command before it.
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
   * returned indexes. Single-select: the active row's value is shown. Multi-select has
   * no preselection: with nothing marked the line has no target and Enter runs nothing.
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
   * present only when at least one row has a state. The page draws a state
   * button on the right of the row (docs/feature-plans/0007 §4) and names the
   * state once, so the meaning does not depend on colour. Rows without `state`
   * show no button.
   *
   * `change` previews what confirming does to a row's state: "toggle" flips each
   * row individually, "on"/"off" sets it. Absent = no preview (the page shows
   * only the current state).
   */
  state?: { label: string; change?: StateChange };
  /**
   * Offer a "create" row: when the filter text matches no row exactly (and is not empty),
   * the page shows one more row after the matches, `+ <label> "<trimmed filter text>"`
   * (e.g. `+ new tag "perc"`), that Enter (or a click) chooses; when nothing else matches it is the
   * only row and has the cursor. Choosing it answers `{ created, picked }` (see `SelectCreated`).
   * Absent: no such row.
   */
  create?: { label: string };
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

/**
 * The answer when the create row was chosen: the trimmed filter text and the indexes
 * of the rows marked at that moment (multi-select; empty in a single-select list).
 */
export interface SelectCreated {
  created: string;
  picked: number[];
}

/** What choosing a row does to its state (see `SelectRequest.state`). */
export type StateChange = "toggle" | "on" | "off";

export interface PickPreview {
  before: string;
  after: string;
}

/** A message for the user. `code` is the exit code it belongs to (0 = informational). */
export interface NotifyRequest {
  text: string;
  code: number;
  /**
   * A button next to Close. Clicking it closes the page with `{"open":true}`; the platform
   * then opens `url` (the one in this request, never one the page sends) in the browser.
   * `url` is a plain https:// URL (checked before it gets here).
   */
  link?: { label: string; url: string };
  /**
   * A structured overview the page draws instead of `text` (which stays the plain fallback):
   * per section a heading, an optional meta text next to it and one line per item. Already
   * capped by the presenter. The dialog is sized from the same content (`sectionsText`).
   */
  sections?: ResultSection[];
}

/**
 * An editor of sections whose items are on or off (plan 0010): the `on` items show as chips with
 * a remove button and each section expands to a checkbox list of all its items. Nothing is applied
 * by the page; it answers once, when Apply is pressed (`BoardAnswer`), or null when closed.
 */
export interface BoardRequest {
  title: string;
  sections: Array<{
    /** Stable key the answer refers to. */
    id: string;
    heading: string;
    /** Short text next to the heading, e.g. a count. */
    meta?: string;
    /** Every candidate item; `on` = it carries the section now. */
    items: Array<{ id: string; label: string; on: boolean }>;
    /** Only the `on` items, as chips without a remove button and without a checkbox list. */
    readonly?: boolean;
  }>;
  /** Offer a "new section" entry (a text field); `pattern` is a regular expression a name must fully match. */
  create?: { label: string; pattern?: string };
  /** The button that sends the answer. */
  apply: { label: string };
}

/**
 * The answer, after core checked it against the request: only real differences (`on` is the new
 * state), none for readonly sections; a change may name a section from `created`, whose items start off.
 */
export interface BoardAnswer {
  changes: Array<{ section: string; item: string; on: boolean }>;
  /** Names of new sections, each matching `create.pattern`, in the order the user added them. */
  created: string[];
}

export interface Ui {
  /** Resolves with what the user entered or picked, or null if they dismissed it. */
  prompt(request: PromptRequest): Promise<PaletteResult | null>;
  /**
   * Resolves with the chosen indexes into `request.items`, `{ fill: index }`
   * when the user pressed Tab on a list that allows it, `{ created, picked }` when the
   * user chose the create row (only offered with `request.create`), or null if cancelled.
   */
  select(request: SelectRequest): Promise<number[] | { fill: number } | SelectCreated | null>;
  notify(request: NotifyRequest): void;
  /** The board editor: resolves with the validated answer, or null if closed or unreadable. */
  board(request: BoardRequest): Promise<BoardAnswer | null>;
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
  /** Called with the settings a palette result carried (also one that carried nothing else). */
  onSettings?: (settings: PaletteSettings) => void,
): Ui {
  const show = (name: string, html: string, width: number, height: number): Promise<string | null> =>
    // A failure is already logged by the queue; here it only counts as dismissed.
    queue.run(name, () => context.ui.showModalDialog(dataUrl(html), width, height)).catch(() => null);

  const ui: Ui = {
    async prompt(request) {
      const html = fillTemplate(promptTemplate, {
        ITEMS: request.items,
        INITIAL: request.initial ?? null,
        COMPLETION: request.completion ?? null,
        SETTINGS: request.settings ?? null,
      });
      const raw = await show("palette", html, PALETTE_WIDTH, paletteHeight(request.settings?.above));
      return takePaletteAnswer(raw, onSettings, (bad) => logger("ui").error(`malformed palette result: ${bad.slice(0, 200)}`));
    },

    async select(request) {
      const html = fillTemplate(selectTemplate, { PICK: request });
      const height = pickHeight(request.items.length, request.preview !== undefined);
      const longest = (texts: Array<string | undefined>) => texts.reduce((m, t) => Math.max(m, t?.length ?? 0), 0);
      const width = pickWidth(longest(request.items.map((i) => i.label)), longest(request.items.map((i) => i.detail)));
      const raw = await show("pick", html, width, height);
      const answer = parseSelectAnswer(raw, request.items.length);
      // A create answer where no create row was offered is treated as cancelled.
      if (answer && !Array.isArray(answer) && "created" in answer) return request.create ? answer : null;
      // A page that answers "fill" where it was not offered is treated as cancelled.
      if (answer && !Array.isArray(answer) && "fill" in answer && !(request.fill && !request.multi)) return null;
      return answer;
    },

    notify(request) {
      const html = fillTemplate(notifyTemplate, { MESSAGE: request.text, LINK: request.link ?? null, SECTIONS: request.sections ?? null });
      const { width, height } = notifySize(request.sections ? sectionsText(request.sections) : request.text);
      void show("message", html, width, height).then((raw) => {
        if (!request.link || !wantsOpen(raw)) return;
        void openUrl(request.link.url)
          .then((result) => {
            if (result.code !== 0) ui.notify({ text: result.message ?? "cannot open the page", code: result.code });
          })
          .catch(() => {});
      });
    },

    async board(request) {
      const html = fillTemplate(boardTemplate, { BOARD: request });
      const { width, height } = boardSize(request);
      return parseBoardAnswer(await show("board", html, width, height), request);
    },

    async page(name, html, width, height) {
      // The SDK resolves an empty string on dismissal: both count as dismissed.
      return (await show(name, html, width, height)) || null;
    },
  };
  return ui;
}
