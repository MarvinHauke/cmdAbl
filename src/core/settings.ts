import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { PaletteResult } from "./types.js";

// cmdAbl's own settings (plan 0006 "Two zones", the first piece of plan 0008's store): one small
// JSON file, `settings.json`, in the extension's data folder (next to the tokens, outside
// modules/). Typed keys with defaults. A missing file means the defaults quietly; a broken file or
// a value of the wrong type means the default and one warning. A write goes to a temporary file
// and is renamed. Nothing throws. No URL, TextEncoder or structuredClone (the host has none).

/** Where the palette shows the options and subcommands: not at all, as a hint panel, or as selectable rows. */
export const ABOVE_VALUES = ["off", "hints", "options"] as const;
export type Above = (typeof ABOVE_VALUES)[number];

/** Core's own keys, with their defaults (the declarations below say the rest: label, help, kind). */
export const SETTINGS_DEFAULTS = {
  "palette.above": "off" as Above,
  /** MIDI mapping (plan 0018): false drops every incoming message, `map --off`. */
  "map.enabled": true,
  /** The MIDI monitor and learn also show incoming messages in Live's status bar (off by default). */
  "midi.statusBar": false,
};

export type SettingKey = keyof typeof SETTINGS_DEFAULTS;
export interface SettingsValues {
  "palette.above": Above;
  "map.enabled": boolean;
  "midi.statusBar": boolean;
}

// ── declared settings (plan 0019 §1) ────────────────────────────────────────

/** A setting as a core or a module declares it; the settings page is generated from these. */
export type SettingDef =
  | { key: string; label: string; help: string; kind: "bool"; default: boolean }
  | { key: string; label: string; help: string; kind: "enum"; default: string; choices: { value: string; label: string }[] }
  | { key: string; label: string; help: string; kind: "int"; default: number; min: number; max: number };

/** One group of the settings page: a module's settings under a heading. The id is the module's name. */
export interface SettingGroup {
  id: string;
  heading: string;
  items: SettingDef[];
}

/** Texts of a declaration are shown in the page; keep them short. */
const MAX_DECLARED_TEXT = 300;

/** Core's own groups (declared here, not by a module). `tag.foldAfter` is tag's own declaration. */
export const CORE_GROUPS: readonly SettingGroup[] = [
  {
    id: "cmdabl",
    heading: "cmdAbl",
    items: [
      {
        key: "palette.above",
        label: "Help above the prompt",
        help: "Show the command's options above the prompt while you type: Help is a read-only panel, Options a list you can pick from. Off keeps the palette clean.",
        kind: "enum",
        default: "off",
        choices: [
          { value: "off", label: "Off" },
          { value: "hints", label: "Help" },
          { value: "options", label: "Options" },
        ],
      },
    ],
  },
  {
    id: "map",
    heading: "MIDI mapping",
    items: [
      { key: "map.enabled", label: "Mapping on", help: "Run the MIDI bindings. Off drops every incoming message (the same as map --off).", kind: "bool", default: true },
    ],
  },
  {
    id: "midi",
    heading: "MIDI monitor",
    items: [
      { key: "midi.statusBar", label: "Status bar", help: "Also show incoming messages in Live's status bar while the monitor or learn runs.", kind: "bool", default: false },
    ],
  },
];

/** Does `value` suit the declaration: a boolean, a listed enum value, or an integer within min…max. */
export function fits(def: SettingDef, value: unknown): boolean {
  switch (def.kind) {
    case "bool":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && def.choices.some((c) => c.value === value);
    case "int":
      return typeof value === "number" && Number.isInteger(value) && value >= def.min && value <= def.max;
  }
}

const KEY_RE = /^[a-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;
const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_DECLARED_TEXT;

/** What is wrong with one declaration (null = nothing). `namespace` is the prefix its key must have (null: core, any). */
export function problemWith(def: unknown, namespace: string | null): string | null {
  if (!isRecord(def)) return "not an object";
  const { key, label, help, kind } = def;
  if (typeof key !== "string" || !KEY_RE.test(key)) return `bad key ${JSON.stringify(key)} (use <module>.<name>)`;
  if (namespace !== null && !key.startsWith(`${namespace}.`)) return `"${key}" is outside the namespace "${namespace}."`;
  if (!text(label)) return `"${key}": label must be a short text`;
  if (!text(help)) return `"${key}": help must be a short text`;
  if (kind === "bool") return typeof def.default === "boolean" ? null : `"${key}": default must be true or false`;
  if (kind === "enum") {
    const choices = def.choices;
    if (!Array.isArray(choices) || choices.length === 0) return `"${key}": an enum needs choices`;
    const seen = new Set<string>();
    for (const c of choices) {
      if (!isRecord(c) || typeof c.value !== "string" || c.value === "" || !text(c.label)) return `"${key}": every choice needs a value and a label`;
      if (seen.has(c.value)) return `"${key}": duplicate choice "${c.value}"`;
      seen.add(c.value);
    }
    return typeof def.default === "string" && seen.has(def.default) ? null : `"${key}": default is not one of the choices`;
  }
  if (kind === "int") {
    const { min, max } = def;
    if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) > (max as number)) return `"${key}": min and max must be integers, min not above max`;
    const d = def.default;
    return Number.isInteger(d) && (d as number) >= (min as number) && (d as number) <= (max as number) ? null : `"${key}": default must be an integer within min…max`;
  }
  return `"${key}": unknown kind ${JSON.stringify(kind)}`;
}

/** The declared groups, in the page's order: core's first, then the modules' by id. */
export interface SettingsRegistry {
  /**
   * A module declares its group (id = the module's name; every key must start with `<id>.`). Problems are
   * warnings and the offending item is dropped (the rest stays); a key already declared is dropped. Returns
   * the problems. Never throws.
   */
  declare(id: string, group: { heading: string; items: SettingDef[] }, options?: { core?: boolean }): string[];
  /** Core's groups in declaration order, then the modules' by id. */
  groups(): SettingGroup[];
  def(key: string): SettingDef | undefined;
  /** Every declared key. */
  keys(): string[];
}

export function createSettingsRegistry(warn: (text: string) => void = () => {}): SettingsRegistry {
  const core: SettingGroup[] = [];
  const modules: SettingGroup[] = [];
  const defs = new Map<string, SettingDef>();
  const registry: SettingsRegistry = {
    declare(id, group, options = {}) {
      const problems: string[] = [];
      const note = (p: string) => {
        problems.push(`settings: ${id}: ${p}`);
        warn(`settings: ${id}: ${p}`);
      };
      if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        note("bad group id; the group was dropped");
        return problems;
      }
      if (!isRecord(group) || !text(group.heading) || !Array.isArray(group.items)) {
        note("a group needs a heading and a list of items; dropped");
        return problems;
      }
      const list = options.core ? core : modules;
      let target = [...core, ...modules].find((g) => g.id === id);
      if (target && !!options.core !== core.includes(target)) {
        note("this id belongs to another group; dropped");
        return problems;
      }
      const items: SettingDef[] = [];
      for (const def of group.items) {
        const problem = problemWith(def, options.core ? null : id);
        if (problem) {
          note(`${problem}; dropped`);
          continue;
        }
        if (defs.has(def.key)) {
          note(`"${def.key}" is declared already; dropped`);
          continue;
        }
        defs.set(def.key, def);
        items.push(def);
      }
      if (items.length === 0) return problems;
      if (!target) {
        target = { id, heading: group.heading, items: [] };
        list.push(target);
      }
      target.items.push(...items);
      return problems;
    },
    groups: () => [...core, ...[...modules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))],
    def: (key) => defs.get(key),
    keys: () => [...defs.keys()],
  };
  for (const g of CORE_GROUPS) registry.declare(g.id, g, { core: true });
  return registry;
}

/** What the palette page gets and returns (plain JSON). */
export interface PaletteSettings {
  above: Above;
}

/** What the palette request carries: the switch's value, and whether the page draws the gear (never when above is off: the clean palette). */
export interface PaletteRequestSettings extends PaletteSettings {
  gear: boolean;
}

export const toPaletteSettings = (values: SettingsValues): PaletteSettings => ({ above: values["palette.above"] });

/** What the palette request carries: the gear only with Help or Options above the prompt (Off is the clean palette). */
export const toPaletteRequestSettings = (values: SettingsValues): PaletteRequestSettings => ({ ...toPaletteSettings(values), gear: values["palette.above"] !== "off" });

/** Core's keys typed, every declared key (a module's, too) by name. */
export type SettingsSnapshot = SettingsValues & Record<string, unknown>;

export interface SettingsStore {
  /** The current values of every declared key (read from disk, and again whenever the file changed since). */
  get(): Promise<SettingsSnapshot>;
  /** Change values and save them. Keys that are not declared and values that do not fit are ignored. Resolves true when saved; the new values are in effect at once either way. */
  set(patch: Partial<SettingsValues> & Record<string, unknown>): Promise<boolean>;
}

export interface SettingsDeps {
  /** The extension's data folder. */
  base: string;
  warn: (text: string) => void;
  /** The declarations that say which keys exist and what fits (default: core's own). */
  registry?: SettingsRegistry;
  fs?: Pick<typeof fsp, "readFile" | "writeFile" | "mkdir" | "rename" | "unlink" | "stat">;
}

export const SETTINGS_FILE = "settings.json";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function createSettingsStore(deps: SettingsDeps): SettingsStore {
  const fs = deps.fs ?? fsp;
  const registry = deps.registry ?? createSettingsRegistry();
  const file = path.join(deps.base, SETTINGS_FILE);
  /** Everything in the file, known keys or not (a module may declare its key after the file was read). */
  let raw: Record<string, unknown> | null = null;
  let warned = new Set<string>();
  let saving: Promise<boolean> = Promise.resolve(true);
  /** How the file looked when it was last read or written (modification time and size; "missing" when absent). */
  let seen: string | null = null;

  /** The file's present stamp. One cheap stat: the file is tiny. */
  async function stamp(): Promise<string> {
    try {
      const st = await fs.stat(file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return "missing";
    }
  }

  async function load(): Promise<Record<string, unknown>> {
    seen = await stamp(); // before the read: a change in between is picked up by the next get
    warned = new Set();
    const loaded: Record<string, unknown> = {};
    let text: string | null = null;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") deps.warn(`settings: cannot read ${SETTINGS_FILE} (${code ?? "error"}); using the defaults`);
    }
    if (text !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (!isRecord(parsed)) deps.warn(`settings: ${SETTINGS_FILE} is not a JSON object; using the defaults`);
      else Object.assign(loaded, parsed);
    }
    return loaded;
  }

  /** The value of every declared key: the file's when it fits the declaration, else the default (and one warning per key). */
  function resolve(from: Record<string, unknown>): SettingsSnapshot {
    const out: Record<string, unknown> = {};
    for (const key of registry.keys()) {
      const def = registry.def(key)!;
      const value = from[key];
      if (value === undefined) out[key] = def.default;
      else if (fits(def, value)) out[key] = value;
      else {
        if (!warned.has(key)) {
          warned.add(key);
          deps.warn(`settings: "${key}" has a wrong value; using the default`);
        }
        out[key] = def.default;
      }
    }
    return out as SettingsSnapshot;
  }

  async function write(snapshot: Record<string, unknown>): Promise<boolean> {
    const temp = path.join(deps.base, `.${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      await fs.mkdir(deps.base, { recursive: true });
      await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await fs.rename(temp, file);
      seen = await stamp(); // our own write is not an outside edit
      return true;
    } catch (e: unknown) {
      deps.warn(`settings: cannot write ${SETTINGS_FILE} (${(e as NodeJS.ErrnoException)?.code ?? "error"})`);
      await fs.unlink(temp).catch(() => {});
      return false;
    }
  }

  /** One operation at a time, so a read never replaces the object a change is about to write. */
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = lock.then(work, work);
    lock = run.then(() => {}, () => {});
    return run;
  };

  /** The file's content: read at the first call and again whenever the file changed since (an edit by hand takes effect at the next open). */
  async function current(): Promise<Record<string, unknown>> {
    await saving; // our own pending write first, so it is not mistaken for an outside edit
    if (raw === null || (await stamp()) !== seen) raw = await load();
    return raw;
  }

  return {
    get: () => exclusive(async () => resolve(await current())),
    set: (patch) =>
      exclusive(async () => {
        const content = await current();
        const now = resolve(content);
        let changed = false;
        for (const [key, value] of Object.entries(patch)) {
          const def = registry.def(key);
          if (def && fits(def, value) && now[key] !== value) {
            content[key] = value;
            now[key] = value;
            changed = true;
          }
        }
        if (!changed) return saving; // nothing differs: no write (every Enter carries the settings along)
        // Keys nobody declares are kept as they are; the declared ones are written whole.
        const snapshot = { ...Object.fromEntries(Object.entries(content).filter(([k]) => !registry.def(k))), ...now };
        // One write after the other, so two quick changes never race on the temporary file.
        saving = saving.then(() => write(snapshot));
        return saving;
      }),
  };
}

/** `{ above: "off" | "hints" | "options" }` from the page, or null for anything else. */
export function parsePaletteSettings(value: unknown): PaletteSettings | null {
  return isRecord(value) && typeof value.above === "string" && (ABOVE_VALUES as readonly string[]).includes(value.above) ? { above: value.above as Above } : null;
}

/**
 * What the palette page returned: the result to run (null when there is none — dismissed, unreadable, or a
 * settings-only answer from Esc after the checkbox was toggled) and the settings to save, if it sent valid ones.
 */
export function parsePaletteAnswer(raw: string | null): { result: PaletteResult | null; settings: PaletteSettings | null; gear?: { text: string } } {
  if (!raw) return { result: null, settings: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { result: null, settings: null };
  }
  if (!isRecord(parsed)) return { result: null, settings: null };
  // The gear (plan 0019): `{ settings: true, text }` — open the settings, then the palette again with `text`.
  if (parsed.settings === true) return { result: null, settings: null, gear: { text: typeof parsed.text === "string" ? parsed.text.slice(0, 2000) : "" } };
  const settings = parsePaletteSettings(parsed.settings); // the old footer switch, read for one release
  const { settings: _settings, ...rest } = parsed;
  const isResult = typeof rest.type === "string" && typeof rest.id === "string";
  return { result: isResult ? (rest as unknown as PaletteResult) : null, settings };
}

/**
 * What the palette surface does with the page's answer: hand valid settings to `onSettings` (a throwing saver
 * is ignored: saving must never fail the run), log an unreadable answer, and return the result to run, or null
 * (dismissed, unreadable, or settings only). Never throws.
 */
export function takePaletteAnswer(
  raw: string | null,
  onSettings: ((settings: PaletteSettings) => void) | undefined,
  logMalformed: (raw: string) => void,
  onGear?: (gear: { text: string }) => void,
): PaletteResult | null {
  if (!raw) return null;
  const answer = parsePaletteAnswer(raw);
  if (answer.gear) {
    try {
      onGear?.(answer.gear);
    } catch {
      // see below
    }
    return null;
  }
  if (answer.settings) {
    try {
      onSettings?.(answer.settings);
    } catch {
      // see above
    }
  }
  if (!answer.result && !answer.settings) logMalformed(raw);
  return answer.result;
}
