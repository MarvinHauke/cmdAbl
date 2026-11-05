import * as fs from "node:fs";
import * as os from "node:os";
import { SCRIPT_VERSION, type BridgeResult, type HelloInfo } from "../ableton/bridgeProtocol.js";
import { defaultScriptFile, inspectInstalledScript, type InstalledScript } from "../ableton/installedScript.js";
import { karabinerImportUrl, type SetupFacts } from "./setupRows.js";

// Gathering the facts the setup rows are built from (plan 0021 §2). Every probe is injectable and none throws:
// what can't be looked at is "unknown" (null), never an error.

/** The description of the rule in karabiner/cmdabl.json; the same text stands in karabiner.json once it is imported. */
export const KARABINER_RULE_DESCRIPTION = "Open cmdAbl command palette with ':' when Ableton Live is focused";

/**
 * Is the cmdAbl rule enabled in Karabiner's own config (`karabiner.json`, read-only)? True when the SELECTED profile lists a
 * rule with the description, false when it lists none, null when the text is not a Karabiner config.
 */
export function ruleEnabledIn(configText: string | null): boolean | null {
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
  if (!Array.isArray(rules)) return false;
  return rules.some((r) => (r as { description?: unknown })?.description === KARABINER_RULE_DESCRIPTION);
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
  const ruleThere = safe(deps.triggerRuleThere, false);
  return {
    platform,
    trigger: { installed: triggerInstalled, ruleThere, enabled: platform === "darwin" && ruleThere ? ruleEnabledIn(safe(deps.karabinerConfig, null)) : null },
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

