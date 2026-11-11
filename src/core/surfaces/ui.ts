import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { PaletteItem, PaletteResult, ResultSection } from "../types.js";
import type { CompletionData } from "../complete/complete.js";
import { PALETTE_WIDTH, PALETTE_HEIGHT } from "./paletteSize.js";
import type { LivePages, LiveRoutes, LiveRun } from "./livePage.js";
import { trackRuns } from "./pageRun.js";
import { takePaletteAnswer } from "../settings/settings.js";
import { parseSelectAnswer } from "./pickResult.js";
import { notifySize, sectionsSize, sectionsText, usesStatusLayout } from "./notifySize.js";
import { boardSize, parseBoardAnswer } from "./board.js";
import { pickHeight, pickWidth } from "./pickSize.js";
import { logger } from "../log.js";
import { fillTemplate } from "./inlineJson.js";
import { createDialogQueue, type DialogQueue } from "./dialogQueue.js";
import promptTemplate from "../../../ui/interface.html";
import selectTemplate from "../../../ui/pick.html";
import { openUrl } from "../setup/openUrl.js";
import { wantsOpen } from "./pickResult.js";
import notifyTemplate from "../../../ui/feedback.html";
import boardTemplate from "../../../ui/board.html";
import settingsTemplate from "../../../ui/settings.html";
import defaultsTemplate from "../../../ui/defaults.html";
import { parseNotifyAnswer } from "./pickResult.js";
import { isGearAnswer, parseSettingsAnswer, settingsSize } from "./settingsSurface.js";
import { defaultsSize, parseDefaultsAnswer } from "./defaultsSurface.js";
import { inlineJson } from "./inlineJson.js";

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
   * Open with this text in the input and the caret at `cursor` (0 = at the
   * start): used when a pick list's Tab put an object into the prompt, e.g.
   * ` "/2-808 Core Kit/808 Core Kit/Snare Drum"` so the user types the command before it.
   * Absent: an empty prompt.
   */
  initial?: { text: string; cursor: number };
  /** `ui.helpLine` (plan 0019 §4): whether the footer explains the command and argument at the caret (off: the keys only). Set by the platform. */
  help?: boolean;
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
  /** `ui.helpLine` (plan 0019 §3): whether the page's help line follows the hover. Set by the platform. */
  help?: boolean;
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
  /**
   * A checkbox in the footer (plan 0021 §4) for a boolean setting. `on` is its initial checked state, `setting` the key the
   * flow saves it to (the page never sends the key). The page answers `{ toggle: boolean }` — with or without an action — and
   * only when the value changed or an action/link button closed it.
   */
  toggle?: { label: string; setting: string; on: boolean };
  /** `ui.helpLine` (plan 0019 §3): whether the page's help line follows the hover. Set by the platform. */
  help?: boolean;
}

/**
 * What the message page answered (`Ui.notifyAnswer`), checked against the request that was sent:
 * `action` is `[sectionIndex, itemIndex]` of a row whose button was clicked (the item has an `action` in the request, else the
 * answer is dropped); `toggle` the checkbox's value (only when the request had one); `open` the link button.
 */
export interface NotifyAnswer {
  action?: [number, number];
  toggle?: boolean;
  open?: true;
}

/**
 * An editor of sections whose items are on or off (plan 0010): the `on` items show as chips with
 * a remove button and each section expands to a checkbox list of all its items. Nothing is applied
 * by the page; it answers once, when Apply is pressed (`BoardAnswer`), or null when closed.
 */
export interface BoardRequest {
  title: string;
  /**
   * Draw the settings gear in the footer (plan 0019; set by the platform, not by the module: the command has
   * settings). The gear answers `{ "settings": true }` (nothing else; with pending changes the page asks
   * "Discard changes and open settings?" first). Core then opens the settings, and afterwards runs the command
   * line again, so the board comes back (also after Esc on the settings). The module only sees a closed board.
   * The WHOLE line runs again: a command that writes before it opens its board would write twice, so only commands
   * that read first and write after the board closes (`tag --list`, `tag --edit`) may be run with a gear.
   */
  gear?: boolean;
  /**
   * A section with more `on` items than this starts folded (plan 0019: the module passes `tag.foldAfter`). Whole
   * number 1–500; anything else is dropped by core and the page uses its own default (20).
   */
  foldAfter?: number;
  /** `ui.helpLine` (plan 0019 §3): whether the page's help line follows the hover. Set by the platform, not by the module. */
  help?: boolean;
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
    /**
     * The heading gets a rename action (✎): the page answers `renamed: [{ section, to }]` with `to` checked against
     * `create.pattern` (no pattern: any non-empty text). An existing name is allowed (the module merges). Created sections are not renamable.
     */
    renamable?: boolean;
    /**
     * The heading gets a remove action (×) that marks the WHOLE section for removal (struck through, undoable until Apply):
     * the page answers `removed: [section]`. Removing one item (× on a chip) is an ordinary change. A section both
     * renamed and removed counts as removed.
     */
    removable?: boolean;
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
  /**
   * Sections of the request flagged `renamable` that the user renamed (`to` is trimmed, matches `create.pattern`, differs
   * from the section id; the last rename of a section wins). Absent when there are none (old callers never see it).
   */
  renamed?: Array<{ section: string; to: string }>;
  /**
   * The parser checks each entry alone, not the combinations: a module may get A→X while X is removed, A→B together
   * with B→A (a swap), or A→X together with B→X (a merge). Order the writes (removals first, renames through a temporary
   * name for a swap) or refuse such a case with a clear message; write them as one undo step (`api.tracks.transaction`).
   *
   * `removed`: sections of the request flagged `removable` that the user marked for removal; wins over a rename of the same
   * section. Absent when there are none. `removed` is applied only when `confirmed` is true (the page asked the user before it
   * closed), or after the module's own question (`api.confirm`) when it is not.
   */
  removed?: string[];
  /** True when the page itself asked the user to confirm the removals before closing; kept only together with a non-empty `removed`. */
  confirmed?: true;
}

// ── the settings surface (plan 0019 §2) ─────────────────────────────────────

/** One row of the settings page. `value` is the stored value, `default` what a reset goes back to. */
export type SettingsRow =
  | { key: string; label: string; help: string; kind: "bool"; value: boolean; default: boolean }
  | { key: string; label: string; help: string; kind: "enum"; value: string; default: string; choices: { value: string; label: string }[] }
  | { key: string; label: string; help: string; kind: "int"; value: number; default: number; min: number; max: number }
  /**
   * A button that leads to another page instead of a value. It closes the page with `{ changes, open: target }`;
   * core saves the changes first, then opens the target. Core sends none in phase 1a (the defaults page comes in
   * 1b); the page renders them from 1a on. `summary` is the dim text on the button ("3 set").
   */
  | { key: string; label: string; help: string; kind: "link"; target: string; summary: string };

/** Sections of the page, one per declaring module (core first, then modules by name). Capped: 20 groups × 50 rows, texts up to 300 characters. */
export interface SettingsRequest {
  /** "cmdAbl Settings", "tag Settings" (the page title; the dialog does not draw it). */
  title: string;
  /** A group id: the page scrolls to it and puts the cursor on its first row. Absent: the top. */
  focus?: string;
  /** `ui.helpLine` (plan 0019 §3): whether the page's help line follows the hover. Set by the platform. */
  help?: boolean;
  groups: Array<{ id: string; heading: string; items: SettingsRow[] }>;
}

/**
 * What the page answers on Enter (Esc answers '' and nothing is saved): only real differences, `changes` by key.
 * `open` is the `target` of a link row that closed the page. Core checks it all with `parseSettingsAnswer`.
 */
export interface SettingsAnswer {
  changes: Record<string, boolean | string | number>;
  open?: string;
}

// ── the defaults surface (plan 0019 §7, a live page) ────────────────────────

/** One row of the defaults page: a top-level command and the line a bare `command` runs. */
export interface DefaultsRow {
  command: string;
  /** The default line; "" = none. After a failed save: the text the user typed (with `error`). */
  line: string;
  /** The command's one-line summary. */
  summary: string;
  /** What the bare word does without a default ("runs on its own", "needs <target>", "shows its subcommands"); a default replaces it. */
  bareBehaviour: string;
  /** Why `line` is not usable (a hand edit that does not parse, or the last save): the page shows it next to the field. */
  error?: string;
  /**
   * The line stored in the file ("" = none), only on a page reopened after a failed save, where `line` is the typed text.
   * Omitted on a first open (= `line`). The page compares against `saved ?? line`, so a typed fix counts as a change and
   * a line put back to `saved` is no change.
   */
  saved?: string;
}

/** One row per top-level command (capped at 200 rows, texts at 300 characters). */
export interface DefaultsRequest {
  title: string;
  /** A command: the page scrolls to its row and puts the cursor in its field. Absent: the top. */
  focus?: string;
  /** `ui.helpLine` (plan 0019 §3): whether the page's help line follows the hover. Set by the platform. */
  help?: boolean;
  /** Dialog height in px, set when the page is opened from the settings page so the window keeps its size (not used by the page). */
  height?: number;
  rows: DefaultsRow[];
}

/**
 * What the page answers on Enter (Esc answers ''): the rows whose line changed, `command → line` ('' = remove the default).
 * Core checks every line again after the page closed; a line that does not parse reopens the page on its row.
 */
export interface DefaultsAnswer {
  changes: Record<string, string>;
}

/**
 * The live check (`GET /live/defaults/check?command=<c>&line=<l>`, read-only, token-bound): `{ ok: true }` or `{ ok: false, error }`.
 * Parses against the command tree; targets are not resolved. Served only while the page is open and only when the local
 * server is up: the page must work without it (the check after closing is the fallback).
 */
export type DefaultsCheck = (command: string, line: string) => { ok: true } | { ok: false; error: string };

export interface Ui {
  /** The defaults page (a live page, `ui/defaults.html`): resolves with the validated answer, or null when closed (Esc) or unreadable. */
  defaults(request: DefaultsRequest, check: DefaultsCheck): Promise<DefaultsAnswer | null>;
  /** The settings page: resolves with the validated answer, or null when closed (Esc) or unreadable. */
  settings(request: SettingsRequest): Promise<SettingsAnswer | null>;
  /** Resolves with what the user entered or picked, or null if they dismissed it. */
  prompt(request: PromptRequest): Promise<PaletteResult | null>;
  /**
   * Resolves with the chosen indexes into `request.items`, `{ fill: index }`
   * when the user pressed Tab on a list that allows it, `{ created, picked }` when the
   * user chose the create row (only offered with `request.create`), or null if cancelled.
   */
  select(request: SelectRequest): Promise<number[] | { fill: number } | SelectCreated | null>;
  notify(request: NotifyRequest): void;
  /**
   * The message page, waited for: resolves with the checked answer when it closes (null when dismissed with nothing to report).
   * Same page and sizing as `notify`; the link button's URL is NOT opened here, the caller sees `open` and decides.
   */
  notifyAnswer(request: NotifyRequest): Promise<NotifyAnswer | null>;
  /** The board editor: resolves with the validated answer, or null if closed or unreadable. */
  board(request: BoardRequest): Promise<BoardAnswer | null>;
  /** A module's own page: resolves with the string it returns on close, or null if dismissed (an empty string counts as dismissed). */
  page(name: string, html: string, width: number, height: number): Promise<string | null>;
  /**
   * A module's page that may READ from the module while it is open (plan 0018 "Live pages"; the read-only exception to
   * the dialog rule): `routes` are served under a one-time token at `http://localhost:27184/live/<name>/<route>`, and the
   * page gets `{ base, token }` where it has `const LIVE = /*LIVE_PLACEHOLDER*\/null;`. It never writes; the close string
   * still comes back as with `page`. If the server cannot serve it (port taken), the page opens as a data page with
   * `LIVE = null` and must work without polling.
   * `options.run` (plan 0018 "Page runs") allows the page to run command lines while open: the command paths (command
   * plus subcommands, e.g. `"stamp loop"`) it may run through `POST <LIVE.base>/run`.
   */
  livePage(name: string, html: string, width: number, height: number, routes: LiveRoutes, options?: LivePageOptions): Promise<string | null>;
}

/** What a module allows a live page beyond reading. */
export interface LivePageOptions {
  /** Command paths the page may run while open, e.g. `["stamp loop", "stamp unloop"]`. Options and arguments are free. */
  run?: string[];
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
  /** The live pages the trigger server serves; absent: live pages open as data pages. */
  live?: LivePages,
  /**
   * A page's gear (plan 0019): the board answered `{ "settings": true }`. Core opens the settings and
   * runs the page's command line again. The surface itself answers null (closed) for it.
   */
  onGear?: (gear: { surface: "board" }) => void,
  /** Builds the page-run handler for an allowlist (`pageRun.ts`); absent: pages cannot run lines. */
  pageRun?: (allow: string[]) => LiveRun,
): Ui {
  const show = (name: string, html: string, width: number, height: number): Promise<string | null> =>
    // A failure is already logged by the queue; here it only counts as dismissed.
    queue.run(name, () => context.ui.showModalDialog(dataUrl(html), width, height)).catch(() => null);

  const notifyHtml = (request: NotifyRequest) =>
    fillTemplate(notifyTemplate, {
      MESSAGE: request.text,
      LINK: request.link ?? null,
      SECTIONS: request.sections ?? null,
      TOGGLE: request.toggle ?? null,
      HELP: request.help ?? null,
    });
  const sizeOf = (request: NotifyRequest): [number, number] => {
    const toggle = request.toggle !== undefined;
    const { width, height } =
      request.sections && usesStatusLayout(request.sections, toggle)
        ? sectionsSize(request.sections, { toggle })
        : notifySize(request.sections ? sectionsText(request.sections) : request.text);
    return [width, height];
  };

  const ui: Ui = {
    async prompt(request) {
      const html = fillTemplate(promptTemplate, {
        ITEMS: request.items,
        INITIAL: request.initial ?? null,
        COMPLETION: request.completion ?? null,
        HELP: request.help ?? null,
      });
      const raw = await show("palette", html, PALETTE_WIDTH, PALETTE_HEIGHT);
      return takePaletteAnswer(raw, (bad) => logger("ui").error(`malformed palette result: ${bad.slice(0, 200)}`));
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

    async notifyAnswer(request) {
      const raw = await show("message", notifyHtml(request), ...sizeOf(request));
      return parseNotifyAnswer(raw, request);
    },

    notify(request) {
      void show("message", notifyHtml(request), ...sizeOf(request)).then((raw) => {
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
      const raw = await show("board", html, width, height);
      // The gear: only where the request drew it. Counts as closed; core opens the settings and runs the command again.
      if (request.gear === true && isGearAnswer(raw)) {
        onGear?.({ surface: "board" });
        return null;
      }
      return parseBoardAnswer(raw, request);
    },

    async settings(request) {
      const html = fillTemplate(settingsTemplate, { SETTINGS: request });
      const { width, height } = settingsSize(request);
      return parseSettingsAnswer(await show("settings", html, width, height), request);
    },

    async defaults(request, check) {
      // The request goes into the page here (the live server fills only LIVE afterwards): `*` is escaped so no text can
      // spell a placeholder for that second pass.
      const html = defaultsTemplate.replace("/*DEFAULTS_PLACEHOLDER*/null", () => inlineJson(request).replace(/\*/g, "\\u002a"));
      const { width, height } = defaultsSize(request);
      const routes: LiveRoutes = {
        check: (query) => {
          const line = typeof query.line === "string" ? query.line : "";
          return check(typeof query.command === "string" ? query.command : "", line.slice(0, 1000));
        },
      };
      return parseDefaultsAnswer(await ui.livePage("defaults", html, width, height, routes), request);
    },

    async page(name, html, width, height) {
      // The SDK resolves an empty string on dismissal: both count as dismissed.
      return (await show(name, html, width, height)) || null;
    },

    async livePage(name, html, width, height, routes, options) {
      const allow = options?.run?.filter((p) => typeof p === "string" && p.trim() !== "");
      // The dialog's result waits for page runs in flight (plan 0018 "Page runs").
      const runs = trackRuns(allow && allow.length > 0 && pageRun ? pageRun(allow) : undefined);
      const session = live?.open(name, html, routes, runs.run) ?? null;
      // No server (port taken) or a bad name: the same page as a data page, `LIVE = null`.
      if (!session) return (await show(name, html, width, height)) || null;
      try {
        // Through the same queue: only one dialog is ever open. A failure is logged by the queue and counts as dismissed.
        const raw = await queue.run(name, () => context.ui.showModalDialog(session.url, width, height)).catch(() => null);
        return raw || null;
      } finally {
        session.close(); // the token and the routes end with the dialog: no new run can start
        if (!(await runs.idle())) logger("ui").warn(`live page "${name}": a page run was still running 3 s after the close`); // runs already started finish first
      }
    },
  };
  return ui;
}
