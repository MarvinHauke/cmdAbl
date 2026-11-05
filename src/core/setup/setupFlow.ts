import type { ModuleFiles } from "../settings/files.js";
import { capSections } from "../surfaces/present.js";
import { buildSetupRows, hasNewTrouble, setupLines, SCRIPT_COMMAND, type SetupFacts, type SetupRows } from "./setupRows.js";
import { ExitCode, ok, fail, type CommandResult, type ItemAction, type ResultSection } from "../types.js";
import type { NotifyAnswer, NotifyRequest } from "../surfaces/ui.js";
import type { SettingsStore } from "../settings/settings.js";

// The setup page's flow (plan 0021 §1, §4): show the rows, run the button the user pressed, show the page again;
// save the checkbox. And the rule for opening by itself. Everything outside (dialog, commands, facts, files) comes in as a
// port, so it is testable without Live.

/** What core remembers between starts: the version the page was last shown for, and which yellow/red rows it showed. */
export interface SetupState {
  seenVersion: string | null;
  shown: string[];
}

export const SETUP_STATE_FILE = "state.json";

export async function readSetupState(files: Pick<ModuleFiles, "read">): Promise<SetupState> {
  try {
    const parsed: unknown = JSON.parse((await files.read(SETUP_STATE_FILE)) ?? "null");
    const r = parsed as { seenVersion?: unknown; shown?: unknown } | null;
    return {
      seenVersion: typeof r?.seenVersion === "string" ? r.seenVersion : null,
      shown: Array.isArray(r?.shown) ? r.shown.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    return { seenVersion: null, shown: [] };
  }
}

/**
 * Should the page open by itself now (plan 0021 §4)? On the first start (no version stored), or when a row needs the user
 * that was not shown before. The same yellow row never reopens it. `next` is the state to store: after opening, what was shown;
 * otherwise the shown rows that are still there (a row that went green and breaks again counts as new).
 */
export function decideOpen(input: { openOnStart: boolean; state: SetupState; rows: SetupRows["rows"]; version: string }): { open: boolean; next: SetupState } {
  const current = input.rows.filter((r) => r.signature !== "").map((r) => r.signature);
  if (!input.openOnStart) return { open: false, next: input.state };
  const open = input.state.seenVersion === null || hasNewTrouble(input.rows, input.state.shown);
  if (open) return { open, next: { seenVersion: input.version, shown: current } };
  return { open, next: { seenVersion: input.state.seenVersion, shown: input.state.shown.filter((s) => current.includes(s)) } };
}

export interface SetupFlowDeps {
  /** The message page, waited for. */
  notifyAnswer: (request: NotifyRequest) => Promise<NotifyAnswer | null>;
  /** True during a headless run (`cmdabl_run`): no page, the rows come back as text. */
  headless: () => boolean;
  facts: (copyFailed: string | null) => Promise<SetupFacts>;
  /** Runs a command line through the normal run path. */
  runCommand: (line: string) => Promise<CommandResult>;
  openUrl: (url: string) => Promise<CommandResult>;
  settings: Pick<SettingsStore, "get" | "set">;
  files: Pick<ModuleFiles, "read" | "write">;
  version: string;
  /** Problems (a failed copy, a setting that could not be saved). */
  warn?: (text: string) => void;
  /** Plain progress lines (default: warn). */
  note?: (text: string) => void;
  /** Copy the Remote Script now (autoScript). */
  copyScript: () => CommandResult;
}

export interface SetupFlow {
  /** `cmdabl setup`: the page, always. Headless: the rows as lines. */
  show(): Promise<CommandResult>;
  /** The opening rule: show the page if it should open by itself now. True when it did. Never throws. */
  openIfNeeded(): Promise<boolean>;
  /** Gather the facts now in the background, so the first `openIfNeeded` does not wait for the probes. Never throws. */
  warmUp(): void;
  /** `setup.autoScript`: copy a missing or older script at start without asking. Never throws. */
  autoCopy(): Promise<void>;
}

const MAX_ROUNDS = 20;
/** Facts gathered ahead are used only this long: a ping from before the bridge connected must not decide. */
const WARM_MS = 20_000;

/** The action in the sections that were sent, or undefined: the only way an answer can name something to run. */
export function actionAt(sections: ResultSection[], at: [number, number]): ItemAction | undefined {
  const item = sections[at[0]]?.items[at[1]];
  return typeof item === "object" && item !== null ? item.action : undefined;
}

export function createSetupFlow(deps: SetupFlowDeps): SetupFlow {
  const warn = deps.warn ?? (() => {});
  const note = deps.note ?? warn;
  /** Facts gathered ahead (warmUp), used once by openIfNeeded. */
  let warm: { facts: Promise<SetupFacts>; at: number } | null = null;
  /** Why the last copy by the page failed; shown as a red row until a copy works. */
  let copyFailed: string | null = null;

  async function request(): Promise<{ req: NotifyRequest; built: SetupRows; sections: ResultSection[] }> {
    const built = buildSetupRows(await deps.facts(copyFailed));
    const sections = capSections(built.sections); // the indexes the answer uses are those of the sections sent
    const openOnStart = (await deps.settings.get())["setup.openOnStart"];
    return {
      built,
      sections,
      req: {
        text: setupLines(sections),
        code: ExitCode.OK,
        sections,
        toggle: { label: "Don't open this page by itself", setting: "setup.openOnStart", on: openOnStart === false },
      },
    };
  }

  async function page(): Promise<SetupRows> {
    let last: SetupRows | undefined;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { req, built, sections } = await request();
      last = built;
      const answer = await deps.notifyAnswer(req);
      if (answer?.toggle !== undefined) {
        const saved = await deps.settings.set({ "setup.openOnStart": !answer.toggle });
        if (!saved) warn("setup: could not save setup.openOnStart");
      }
      const action = answer?.action ? actionAt(sections, answer.action) : undefined;
      if (!action) break;
      if ("command" in action) {
        const result = await deps.runCommand(action.command);
        if (action.command === SCRIPT_COMMAND) copyFailed = result.code === ExitCode.OK ? null : (result.message ?? "failed");
        else if (result.code !== ExitCode.OK) warn(`setup: ${action.command}: ${result.message ?? "failed"}`);
      } else {
        const result = await deps.openUrl(action.url);
        if (result.code !== ExitCode.OK) warn(`setup: ${result.message ?? "cannot open the link"}`);
      }
    }
    return last ?? { sections: [], rows: [] };
  }

  return {
    async show() {
      try {
        if (deps.headless()) return ok(setupLines(buildSetupRows(await deps.facts(copyFailed)).sections));
        const built = await page();
        // A page the user opened himself counts as seen: what it showed does not reopen it by itself.
        await deps.files.write(SETUP_STATE_FILE, JSON.stringify({ seenVersion: deps.version, shown: built.rows.filter((r) => r.signature !== "").map((r) => r.signature) } satisfies SetupState));
        return ok();
      } catch (e: unknown) {
        return fail(ExitCode.FAILURE, `setup: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    async openIfNeeded() {
      try {
        if (deps.headless()) return false;
        const openOnStart = (await deps.settings.get())["setup.openOnStart"] !== false;
        const state = await readSetupState(deps.files);
        const ahead = warm;
        warm = null;
        const built = buildSetupRows(await (ahead && Date.now() - ahead.at < WARM_MS ? ahead.facts : deps.facts(copyFailed)));
        const decision = decideOpen({ openOnStart, state, rows: built.rows, version: deps.version });
        if (!decision.open) {
          if (decision.next !== state) await deps.files.write(SETUP_STATE_FILE, JSON.stringify(decision.next));
          return false;
        }
        await deps.files.write(SETUP_STATE_FILE, JSON.stringify(decision.next)); // before the page: a page that fails to open does not reopen forever
        await page();
        return true;
      } catch (e: unknown) {
        warn(`setup: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    },

    warmUp() {
      const facts = deps.facts(null);
      facts.catch(() => {}); // openIfNeeded sees the rejection itself
      warm = { facts, at: Date.now() };
    },

    async autoCopy() {
      try {
        if ((await deps.settings.get())["setup.autoScript"] !== true) return;
        const facts = await deps.facts(null);
        const status = facts.script.installed.status;
        if (status !== "missing" && status !== "outdated") return;
        const result = deps.copyScript();
        if (result.code !== ExitCode.OK) warn(`setup: automatic copy of the Remote Script failed: ${result.message ?? "failed"}`);
        else note(`setup: Remote Script ${facts.script.shipped} copied automatically; restart Live once to load it`);
      } catch (e: unknown) {
        warn(`setup: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
