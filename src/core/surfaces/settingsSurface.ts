// The `settings` surface (plan 0019 §2): what is pure about it — building the request from the declarations, capping
// it, checking the page's answer, the dialog size and the gear answer. The contract types live in ui.ts. The flow that
// opens the page and saves the answer (`createSettingsFlow`) takes the store and the surface as ports, so it is
// testable without Live.

import { MAX_TEXT } from "./present.js";
import { ok, fail, ExitCode, type CommandResult } from "../types.js";
import { logger } from "../log.js";
import type { SettingGroup, SettingsRegistry, SettingsStore } from "../settings/settings.js";
import { fits } from "../settings/settings.js";
import type { SettingsAnswer, SettingsRequest, SettingsRow, Ui } from "./ui.js";

export const MAX_GROUPS = 20;
export const MAX_ROWS = 50;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clip = (value: unknown): string => {
  const t = typeof value === "string" ? value : "";
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
};

/** Did the page ask for the settings: the answer is exactly `{ "settings": true }` (plus a palette's `text`). */
export function isGearAnswer(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && value.settings === true;
  } catch {
    return false;
  }
}

/** The request for the given groups with the current `values`. `only` shows just that group (`tag config`); `focus` scrolls to a group. */
export function buildSettingsRequest(
  groups: readonly SettingGroup[],
  values: Record<string, unknown>,
  options: { title: string; focus?: string; only?: string },
): SettingsRequest {
  const shown = options.only === undefined ? groups : groups.filter((g) => g.id === options.only);
  return {
    title: options.title,
    ...(options.focus !== undefined && shown.some((g) => g.id === options.focus) ? { focus: options.focus } : {}),
    groups: shown.map((g) => ({
      id: g.id,
      heading: g.heading,
      items: g.items.map((def): SettingsRow => {
        const value = fits(def, values[def.key]) ? values[def.key] : def.default;
        const base = { key: def.key, label: def.label, help: def.help };
        if (def.kind === "bool") return { ...base, kind: "bool", value: value as boolean, default: def.default };
        if (def.kind === "enum") return { ...base, kind: "enum", value: value as string, default: def.default, choices: def.choices.map((c) => ({ ...c })) };
        return { ...base, kind: "int", value: value as number, default: def.default, min: def.min, max: def.max };
      }),
    })),
  };
}

/** The request as the page gets it: at most 20 groups × 50 rows, every text at most 300 characters, rows and groups without an id/key dropped. */
export function capSettings(request: SettingsRequest): { request: SettingsRequest; cut: boolean } {
  let cut = false;
  const groups: SettingsRequest["groups"] = [];
  const seenKeys = new Set<string>();
  const seenGroups = new Set<string>();
  for (const group of Array.isArray(request.groups) ? request.groups : []) {
    const id = typeof group?.id === "string" && group.id !== "" && group.id.length <= MAX_TEXT ? group.id : "";
    if (!id || seenGroups.has(id) || groups.length >= MAX_GROUPS) {
      cut = true;
      continue;
    }
    seenGroups.add(id);
    const items: SettingsRow[] = [];
    for (const row of Array.isArray(group.items) ? group.items : []) {
      const key = typeof row?.key === "string" && row.key !== "" && row.key.length <= MAX_TEXT ? row.key : "";
      if (!key || seenKeys.has(key) || items.length >= MAX_ROWS) {
        cut = true;
        continue;
      }
      seenKeys.add(key);
      const label = clip(row.label) || key;
      const help = clip(row.help);
      if (label !== row.label || help !== row.help) cut = true;
      if (row.kind === "link") {
        items.push({ key, label, help, kind: "link", target: clip(row.target), summary: clip(row.summary) });
      } else if (row.kind === "bool") {
        items.push({ key, label, help, kind: "bool", value: row.value === true, default: row.default === true });
      } else if (row.kind === "enum") {
        const choices = (Array.isArray(row.choices) ? row.choices : []).filter((c) => typeof c?.value === "string").map((c) => ({ value: clip(c.value), label: clip(c.label) || clip(c.value) }));
        if (choices.length === 0) {
          cut = true;
          seenKeys.delete(key);
          continue;
        }
        const has = (v: unknown) => choices.some((c) => c.value === v);
        items.push({ key, label, help, kind: "enum", value: has(row.value) ? (row.value as string) : choices[0]!.value, default: has(row.default) ? (row.default as string) : choices[0]!.value, choices });
      } else if (row.kind === "int" && Number.isInteger(row.min) && Number.isInteger(row.max) && row.min <= row.max) {
        const within = (v: unknown, fallback: number) => (Number.isInteger(v) && (v as number) >= row.min && (v as number) <= row.max ? (v as number) : fallback);
        items.push({ key, label, help, kind: "int", value: within(row.value, row.min), default: within(row.default, row.min), min: row.min, max: row.max });
      } else {
        cut = true;
        seenKeys.delete(key);
      }
    }
    const heading = clip(group.heading).trim() || id;
    groups.push({ id, heading, items });
  }
  if ((request.groups?.length ?? 0) > MAX_GROUPS) cut = true;
  const focus = typeof request.focus === "string" && groups.some((g) => g.id === request.focus) ? request.focus : undefined;
  return {
    request: {
      title: clip(request.title),
      ...(focus !== undefined ? { focus } : {}),
      ...(typeof request.help === "boolean" ? { help: request.help } : {}),
      groups,
    },
    cut,
  };
}

/**
 * The page's answer, checked against the request it was given. Null (and a log line) for anything that is not an
 * answer object; never throws. `changes` keeps only keys of real value rows of the request (not link rows), values
 * of the row's kind that fit (a listed enum value, a whole number within min…max) and that differ from the
 * request's value. `open` is kept only when it is the `target` of a link row.
 */
export function parseSettingsAnswer(raw: string | null | undefined, request: SettingsRequest, log: (line: string) => void = (line) => logger("settings").warn(line)): SettingsAnswer | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    log(`malformed settings answer: ${raw.slice(0, 80)}`);
    return null;
  }
  if (!isRecord(value)) {
    log("settings answer is not an object");
    return null;
  }
  const rows = new Map<string, SettingsRow>();
  const targets = new Set<string>();
  for (const g of request.groups) {
    for (const row of g.items) {
      if (row.kind === "link") targets.add(row.target);
      else rows.set(row.key, row);
    }
  }
  const changes: SettingsAnswer["changes"] = {};
  if (isRecord(value.changes)) {
    for (const [key, v] of Object.entries(value.changes)) {
      const row = rows.get(key);
      if (!row || row.kind === "link" || v === row.value) continue;
      const suits =
        row.kind === "bool" ? typeof v === "boolean" : row.kind === "enum" ? typeof v === "string" && row.choices.some((c) => c.value === v) : typeof v === "number" && Number.isInteger(v) && v >= row.min && v <= row.max;
      if (suits) changes[key] = v as boolean | string | number;
    }
  } else if (value.changes !== undefined) {
    log("settings answer has changes that are not an object");
  }
  const open = typeof value.open === "string" && targets.has(value.open) ? value.open : undefined;
  return { changes, ...(open !== undefined ? { open } : {}) };
}

/** Dialog size: a row is about 46 px, a heading 40; the page scrolls beyond the maximum. */
export function settingsSize(request: SettingsRequest): { width: number; height: number } {
  const rows = request.groups.reduce((n, g) => n + g.items.length, 0);
  const height = 120 + request.groups.length * 40 + rows * 46;
  return { width: 640, height: Math.min(Math.max(height, 260), 560) };
}

/** "2 settings saved". */
const savedText = (count: number): string => `${count} setting${count === 1 ? "" : "s"} saved`;

export interface SettingsFlowDeps {
  registry: SettingsRegistry;
  store: SettingsStore;
  ui: Pick<Ui, "settings">;
  /** A link row closed the page (phase 1b): core opens the target after the changes were saved. */
  onOpen?: (target: string, window: { height: number }) => Promise<CommandResult | void>;
  /** Link rows core adds to a group's page (phase 1b: the default-commands rows), after its declared rows. Never throws; a throw means none. */
  links?: (group: string) => Promise<SettingsRow[]>;
  log?: (line: string) => void;
}

export interface SettingsFlow {
  /**
   * Show the settings. `group` focuses a group; `only` limits the page to that group (`<module> config`). Saves what the
   * page answers after it closed and answers with one line ("2 settings saved"), or exit 1 when the file could not be
   * written; closing without Enter changes nothing and says nothing. `cmdabl config <unknown>` is exit 3. Never throws.
   */
  open(options?: { group?: string; only?: boolean }): Promise<CommandResult>;
  /** The declared groups (id and heading), in page order. */
  groups(): Array<{ id: string; heading: string }>;
  /** Does this module (top-level command) have a settings group? */
  has(group: string): boolean;
}

export function createSettingsFlow(deps: SettingsFlowDeps): SettingsFlow {
  const warn = deps.log ?? ((line: string) => logger("settings").warn(line));
  return {
    groups: () => deps.registry.groups().map((g) => ({ id: g.id, heading: g.heading })),
    has: (group) => deps.registry.groups().some((g) => g.id === group),
    async open(options = {}) {
      try {
        const groups = [...deps.registry.groups()];
        // A command without declared settings still has a page when core gives it link rows (`mute config`: its default command).
        if (options.group !== undefined && !groups.some((g) => g.id === options.group) && deps.links) {
          let rows: SettingsRow[] = [];
          try {
            rows = await deps.links(options.group);
          } catch {
            rows = [];
          }
          if (rows.length > 0) groups.push({ id: options.group, heading: options.group, items: [] });
        }
        if (options.group !== undefined && !groups.some((g) => g.id === options.group)) {
          return fail(ExitCode.NOT_FOUND, `config: no settings group "${options.group}" (groups: ${groups.map((g) => g.id).join(", ")})`);
        }
        const values = await deps.store.get();
        const heading = options.only && options.group ? options.group : "cmdAbl";
        const built = buildSettingsRequest(groups, values, {
          title: `${heading} Settings`,
          ...(options.group !== undefined ? { focus: options.group } : {}),
          ...(options.only && options.group !== undefined ? { only: options.group } : {}),
        });
        if (deps.links) {
          for (const g of built.groups) {
            try {
              g.items.push(...(await deps.links(g.id)));
            } catch {
              // a broken link source only means no link rows
            }
          }
        }
        const { request, cut } = capSettings(built);
        if (cut) warn("settings: the page was cut (more than 20 groups, 50 rows or texts over 300 characters)");
        const answer = await deps.ui.settings(request);
        if (!answer) return ok();
        const count = Object.keys(answer.changes).length;
        let result: CommandResult = ok();
        if (count > 0) {
          const saved = await deps.store.set(answer.changes);
          result = saved ? { ...ok(savedText(count)), log: Object.entries(answer.changes).map(([k, v]) => `set ${k} = ${JSON.stringify(v)}`) } : fail(ExitCode.FAILURE, "config: the settings could not be saved (they stay in effect until Live restarts)");
        }
        if (answer.open !== undefined && deps.onOpen) {
          const opened = await deps.onOpen(answer.open, { height: settingsSize(request).height });
          if (opened && opened.code !== ExitCode.OK) return opened;
          // What the opened page saved is told too ("1 setting saved, 2 default commands saved").
          if (opened?.message) {
            result = { ...result, message: [result.message, opened.message].filter(Boolean).join(", "), log: [...(result.log ?? []), ...(opened.log ?? [])] };
          }
        }
        return result;
      } catch (e: unknown) {
        return fail(ExitCode.FAILURE, `config: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
