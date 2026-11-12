import * as fs from "node:fs";
import * as os from "node:os";
import { SCRIPT_VERSION, type BridgeResult, type HelloInfo } from "../../ableton/bridgeProtocol.js";
import { defaultScriptFile, inspectInstalledScript, type InstalledScript } from "../../ableton/installedScript.js";
import { karabinerImportUrl, type SetupFacts } from "./setupRows.js";

// Gathering the facts the setup rows are built from (plan 0021 §2). Every probe is injectable and none throws:
// what can't be looked at is "unknown" (null), never an error.

/** The description of the rule in karabiner/cmdabl.json; the same text stands in karabiner.json once it is imported. */
export const KARABINER_RULE_DESCRIPTION = "Open cmdAbl command palette with ':' when Ableton Live is focused";

/**
 * The cmdAbl rule in Karabiner's own config (`karabiner.json`, read-only), SELECTED profile: "enabled" when it lists a rule with
 * the description (a missing `enabled` field or `true` counts as enabled), "disabled" when that rule has `enabled: false`
 * (Karabiner keeps a switched-off rule in the file), "absent" when it lists none, null when the text is not a Karabiner config.
 */
export function ruleStateIn(configText: string | null): "enabled" | "disabled" | "absent" | null {
  if (configText === null) return null;
  let config: unknown;
  try {
    config = JSON.parse(configText);
  } catch {
    return null;
  }
  const profiles = (config as { profiles?: unknown } | null)?.profiles;
  if (!Array.isArray(profiles)) return null;
  const selected = profiles.find((p) => (p as { selected?: unknown })?.selected === true) ?? profiles[0];
  const rules = (selected as { complex_modifications?: { rules?: unknown } } | undefined)?.complex_modifications?.rules;
  if (!Array.isArray(rules)) return "absent";
  const mine = rules.filter((r) => (r as { description?: unknown })?.description === KARABINER_RULE_DESCRIPTION);
  if (mine.length === 0) return "absent";
  return mine.some((r) => (r as { enabled?: unknown }).enabled !== false) ? "enabled" : "disabled";
}

/** Is the rule listed and switched on? True only for "enabled"; null when the config can't be read. */
export function ruleEnabledIn(configText: string | null): boolean | null {
  const state = ruleStateIn(configText);
  return state === null ? null : state === "enabled";
}

export interface FactsDeps {
  platform?: NodeJS.Platform;
  port: number;
  controlSurfaceUrl: string;
  shipped?: string;
  /** Karabiner installed / AutoHotkey installed. */
  triggerInstalled: () => boolean;
  /** The rule file (macOS) or startup script (Windows) is there. */
  triggerRuleThere: () => boolean;
  /** karabiner.json as text, or null. */
  karabinerConfig: () => string | null;
  installed?: () => InstalledScript;
  /** A fresh hello; absent: not asked. */
  ping?: () => Promise<BridgeResult<HelloInfo>>;
  /** When the extension host started (ms since the epoch). */
  hostStart: number;
  /** The installed script's file time (ms), or null. */
  scriptTime?: () => number | null;
  /** The data folder, to check it can be written. */
  dataFolder: string;
  writable?: (folder: string) => boolean;
  copyFailed?: string | null;
}

export function writableFolder(folder: string): boolean {
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.accessSync(folder, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function scriptTimeOf(home = os.homedir()): number | null {
  try {
    return fs.statSync(defaultScriptFile(home)).mtimeMs;
  } catch {
    return null;
  }
}

export async function gatherFacts(deps: FactsDeps): Promise<SetupFacts> {
  const platform = deps.platform ?? process.platform;
  let running: BridgeResult<HelloInfo> | null = null;
  if (deps.ping) {
    try {
      running = await deps.ping();
    } catch {
      running = null; // the bridge promises not to throw; setup never fails over this
    }
  }
  const safe = <T>(read: () => T, otherwise: T): T => {
    try {
      return read();
    } catch {
      return otherwise;
    }
  };
  const installed = safe(deps.installed ?? (() => inspectInstalledScript()), { status: "unknown" } as InstalledScript);
  const time = safe(deps.scriptTime ?? (() => scriptTimeOf()), null);
  const triggerInstalled = safe(deps.triggerInstalled, false);
  const fileThere = safe(deps.triggerRuleThere, false);
  // macOS: an enabled rule in karabiner.json wins whatever the imported asset file is called; the file check only tells "not added" from "added, not enabled".
  const state = platform === "darwin" ? ruleStateIn(safe(deps.karabinerConfig, null)) : null;
  const enabled = state === null ? null : state === "enabled";
  const ruleThere = fileThere || state === "enabled" || state === "disabled"; // a switched-off rule still counts as added
  return {
    platform,
    trigger: { installed: triggerInstalled, ruleThere, enabled: ruleThere ? enabled : null },
    script: {
      shipped: deps.shipped ?? SCRIPT_VERSION,
      installed,
      running,
      copyNewerThanHost: time === null ? null : time > deps.hostStart,
      copyFailed: deps.copyFailed ?? null,
    },
    dataFolderWritable: safe(() => (deps.writable ?? writableFolder)(deps.dataFolder), false),
    importUrl: karabinerImportUrl(deps.port),
    controlSurfaceUrl: deps.controlSurfaceUrl,
  };
}

