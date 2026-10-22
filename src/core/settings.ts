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

/** Every key, with its default; the type of the default is the type the value must have. */
export const SETTINGS_DEFAULTS = {
  "palette.above": "off" as Above,
};

/** The allowed values of a key whose values are a closed list (a value outside it counts as the wrong type). */
const ALLOWED: Partial<Record<SettingKey, readonly unknown[]>> = { "palette.above": ABOVE_VALUES };

export type SettingKey = keyof typeof SETTINGS_DEFAULTS;
export interface SettingsValues {
  "palette.above": Above;
}

/** Does `value` suit the key: the default's type, and one of the allowed values when the key has a list. */
const fits = (key: SettingKey, value: unknown): boolean =>
  typeof value === typeof SETTINGS_DEFAULTS[key] && (ALLOWED[key]?.includes(value) ?? true);

/** What the palette page gets and returns (plain JSON). */
export interface PaletteSettings {
  above: Above;
}

export const toPaletteSettings = (values: SettingsValues): PaletteSettings => ({ above: values["palette.above"] });

export interface SettingsStore {
  /** The current values (read from disk once, then kept). */
  get(): Promise<SettingsValues>;
  /** Change values and save them. Resolves true when saved; the new values are in effect at once either way. */
  set(patch: Partial<SettingsValues>): Promise<boolean>;
}

export interface SettingsDeps {
  /** The extension's data folder. */
  base: string;
  warn: (text: string) => void;
  fs?: Pick<typeof fsp, "readFile" | "writeFile" | "mkdir" | "rename" | "unlink">;
}

export const SETTINGS_FILE = "settings.json";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function createSettingsStore(deps: SettingsDeps): SettingsStore {
  const fs = deps.fs ?? fsp;
  const file = path.join(deps.base, SETTINGS_FILE);
  let values: SettingsValues | null = null;
  /** Keys this version does not know are kept when the file is written again. */
  let extra: Record<string, unknown> = {};
  let loading: Promise<SettingsValues> | null = null;
  let saving: Promise<boolean> = Promise.resolve(true);

  async function load(): Promise<SettingsValues> {
    const loaded: SettingsValues = { ...SETTINGS_DEFAULTS };
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
      if (!isRecord(parsed)) {
        deps.warn(`settings: ${SETTINGS_FILE} is not a JSON object; using the defaults`);
      } else {
        for (const [key, value] of Object.entries(parsed)) {
          if (key in SETTINGS_DEFAULTS) {
            if (fits(key as SettingKey, value)) (loaded as unknown as Record<string, unknown>)[key] = value;
            else deps.warn(`settings: "${key}" has a wrong value; using the default`);
          } else {
            extra[key] = value;
          }
        }
      }
    }
    return loaded;
  }

  async function write(snapshot: Record<string, unknown>): Promise<boolean> {
    const temp = path.join(deps.base, `.${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      await fs.mkdir(deps.base, { recursive: true });
      await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await fs.rename(temp, file);
      return true;
    } catch (e: unknown) {
      deps.warn(`settings: cannot write ${SETTINGS_FILE} (${(e as NodeJS.ErrnoException)?.code ?? "error"})`);
      await fs.unlink(temp).catch(() => {});
      return false;
    }
  }

  const get = async (): Promise<SettingsValues> => {
    if (values) return values;
    loading ??= load();
    values ??= await loading;
    return values;
  };

  return {
    get: async () => ({ ...(await get()) }),
    async set(patch) {
      const current = await get();
      let changed = false;
      for (const [key, value] of Object.entries(patch)) {
        if (key in SETTINGS_DEFAULTS && fits(key as SettingKey, value) && (current as unknown as Record<string, unknown>)[key] !== value) {
          (current as unknown as Record<string, unknown>)[key] = value;
          changed = true;
        }
      }
      if (!changed) return saving; // nothing differs: no write (every Enter carries the settings along)
      const snapshot = { ...extra, ...current };
      // One write after the other, so two quick changes never race on the temporary file.
      saving = saving.then(() => write(snapshot));
      return saving;
    },
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
export function parsePaletteAnswer(raw: string | null): { result: PaletteResult | null; settings: PaletteSettings | null } {
  if (!raw) return { result: null, settings: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { result: null, settings: null };
  }
  if (!isRecord(parsed)) return { result: null, settings: null };
  const settings = parsePaletteSettings(parsed.settings);
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
): PaletteResult | null {
  if (!raw) return null;
  const answer = parsePaletteAnswer(raw);
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
