import * as os from "node:os";
import * as path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { childEnv } from "./childEnv.js";
import { isSameDirectory } from "./samePath.js";
import { KARABINER_RULE_DESCRIPTION } from "./setupFacts.js";

/** What a setup step did: ok = it worked (or there was nothing to do), text = one line for the user. */
export interface StepResult {
  ok: boolean;
  text: string;
}

const stepOf = (result: { status: number | null; stdout?: string | null; stderr?: string | null }): StepResult => ({
  ok: result.status === 0,
  text: ((result.stdout ?? "") + (result.stderr ?? "")).trim() || (result.status === 0 ? "Setup complete." : "Setup failed."),
});

// ── macOS / Karabiner-Elements ───────────────────────────────────────────────

const KARABINER_APP = "/Applications/Karabiner-Elements.app";
const KARABINER_MODS_DIR = path.join(
  os.homedir(),
  ".config/karabiner/assets/complex_modifications",
);
const KARABINER_SYMLINK_NAME = "cmdabl.json";

// Paths below are relative to the BUNDLE (dist/extension.js, where __dirname is dist/), not to this file:
// the repository folders karabiner/, windows/ and remote-script/ sit next to dist/.
export function karabinerSourcePath(): string {
  return path.resolve(__dirname, "../karabiner/cmdabl.json");
}

/** The rule file is in Karabiner's folder: our `cmdabl.json` link, or any .json that holds the rule (Karabiner's import saves it as `<timestamp>.json`). Read-only, through bash. */
export function isKarabinerSetupDone(dir: string = KARABINER_MODS_DIR): boolean {
  try {
    const target = path.join(dir, KARABINER_SYMLINK_NAME);
    const script = 'test -e "$CMDABL_TARGET" || grep -lsF -- "$CMDABL_DESC" "$CMDABL_DIR"/*.json >/dev/null 2>&1';
    const result = spawnSync("bash", ["-c", script], {
      stdio: "ignore",
      timeout: 2000,
      env: childEnv({ CMDABL_TARGET: target, CMDABL_DIR: dir, CMDABL_DESC: KARABINER_RULE_DESCRIPTION }),
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function runKarabinerSetup(): StepResult {
  const source = karabinerSourcePath();
  const target = path.join(KARABINER_MODS_DIR, KARABINER_SYMLINK_NAME);

  const script = `
if [ ! -d "$CMDABL_APP" ]; then
  echo "ERROR: Karabiner-Elements not found at $CMDABL_APP"
  exit 1
fi
if [ ! -f "$CMDABL_SOURCE" ]; then
  echo "ERROR: rule file not found at $CMDABL_SOURCE"
  exit 1
fi
mkdir -p "$CMDABL_MODS_DIR"
if [ -e "$CMDABL_TARGET" ]; then
  echo "SKIP: rule already linked."
  echo "Delete $CMDABL_TARGET to re-run."
  exit 0
fi
ln -sf "$CMDABL_SOURCE" "$CMDABL_TARGET"
echo "OK: Karabiner rule linked successfully."
echo "Next: Karabiner-Elements → Complex Modifications → Add predefined rule → cmdAbl → Enable"
`.trim();

  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: childEnv({
      CMDABL_APP: KARABINER_APP,
      CMDABL_SOURCE: source,
      CMDABL_TARGET: target,
      CMDABL_MODS_DIR: KARABINER_MODS_DIR,
    }),
  });

  return stepOf(result);
}

/** Is Karabiner-Elements installed. Through bash like the other probes: the installed host may not stat outside its folders. */
export function isKarabinerInstalled(): boolean {
  try {
    return spawnSync("bash", ["-c", 'test -d "$CMDABL_APP"'], { stdio: "ignore", env: childEnv({ CMDABL_APP: KARABINER_APP }) }).status === 0;
  } catch {
    return false;
  }
}

/** Karabiner's own `karabiner.json` as text (read-only), or null when absent or unreadable. */
export function readKarabinerConfig(): string | null {
  try {
    const file = path.join(os.homedir(), ".config/karabiner/karabiner.json");
    const r = spawnSync("bash", ["-c", 'cat "$CMDABL_FILE"'], { encoding: "utf8", env: childEnv({ CMDABL_FILE: file }) });
    return r.status === 0 ? (r.stdout ?? "") : null;
  } catch {
    return null;
  }
}

// ── Windows / AutoHotkey ─────────────────────────────────────────────────────

const WIN_STARTUP_DIR = path.join(
  process.env["APPDATA"] ?? "",
  "Microsoft\\Windows\\Start Menu\\Programs\\Startup",
);
const WIN_SCRIPT_NAME = "cmdabl.ahk";

function ahkSourcePath(): string {
  return path.resolve(__dirname, "../windows/cmdabl.ahk");
}

export function isAhkSetupDone(): boolean {
  try {
    const target = path.join(WIN_STARTUP_DIR, WIN_SCRIPT_NAME);
    const result = spawnSync(
      "powershell",
      ["-NonInteractive", "-Command", "Test-Path -LiteralPath $env:CMDABL_TARGET"],
      { encoding: "utf8", env: childEnv({ CMDABL_TARGET: target }) },
    );
    return result.stdout?.trim() === "True";
  } catch {
    return false;
  }
}

/** Is AutoHotkey v2 installed (Windows). */
export function isAhkInstalled(): boolean {
  try {
    const script =
      "if (@('C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe','C:\\Program Files\\AutoHotkey\\AutoHotkey.exe','C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe') | Where-Object { Test-Path $_ }) { 'True' } else { 'False' }";
    return spawnSync("powershell", ["-NonInteractive", "-Command", script], { encoding: "utf8", env: childEnv() }).stdout?.trim() === "True";
  } catch {
    return false;
  }
}

export function runAhkSetup(): StepResult {
  const source = ahkSourcePath();
  const target = path.join(WIN_STARTUP_DIR, WIN_SCRIPT_NAME);

  const script = `
$ahkPaths = @(
  'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe',
  'C:\\Program Files\\AutoHotkey\\AutoHotkey.exe',
  'C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe'
)
if (-not ($ahkPaths | Where-Object { Test-Path $_ })) {
  Write-Output 'ERROR: AutoHotkey v2 not found. Install from https://www.autohotkey.com'
  exit 1
}
if (-not (Test-Path $env:CMDABL_SOURCE)) {
  Write-Output "ERROR: AHK script not found at $env:CMDABL_SOURCE"
  exit 1
}
New-Item -ItemType Directory -Force -Path $env:CMDABL_STARTUP_DIR | Out-Null
if (Test-Path $env:CMDABL_TARGET) {
  Write-Output "SKIP: $env:CMDABL_TARGET already exists. Delete it to re-run."
  exit 0
}
Copy-Item $env:CMDABL_SOURCE $env:CMDABL_TARGET
Write-Output 'OK: AutoHotkey script installed to startup folder.'
Write-Output 'Next: open cmdabl.ahk manually to activate now, or restart to auto-start.'
`.trim();

  const result = spawnSync("powershell", ["-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: childEnv({
      CMDABL_SOURCE: source,
      CMDABL_TARGET: target,
      CMDABL_STARTUP_DIR: WIN_STARTUP_DIR,
    }),
  });

  return stepOf(result);
}

// ── Remote Script bridge ─────────────────────────────────────────────────────
// Copies the companion Remote Script (which enables track selection) into Live's
// User Library. Selecting it as a Control Surface and restarting Live can't be
// automated — Live has no API for either — so we just install the files; what
// the user has to do next is advised by core/setup/setupAdvice.ts from the versions.

function remoteScriptSourcePath(): string {
  return path.resolve(__dirname, "../remote-script/cmdAbl");
}

const MAC_REMOTE_SCRIPTS_DIR = path.join(
  os.homedir(),
  "Music/Ableton/User Library/Remote Scripts",
);

/** The User Library folder already is the repository's folder (a link): there is nothing to copy. */
function linkedRemoteScriptMessage(source: string): string {
  return `OK: Remote Script is linked to ${source} (nothing to copy)`;
}

export function runMacRemoteScriptSetup(source = remoteScriptSourcePath(), target = path.join(MAC_REMOTE_SCRIPTS_DIR, "cmdAbl")): StepResult {
  if (isSameDirectory(source, target)) return { ok: true, text: linkedRemoteScriptMessage(source) };

  const script = `
if [ ! -d "$CMDABL_RS_SOURCE" ]; then
  echo "ERROR: Remote Script source not found at $CMDABL_RS_SOURCE"
  exit 1
fi
mkdir -p "$CMDABL_RS_TARGET"
cp -R "$CMDABL_RS_SOURCE"/. "$CMDABL_RS_TARGET"/
echo "OK: Remote Script installed to $CMDABL_RS_TARGET"
`.trim();

  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: childEnv({
      CMDABL_RS_SOURCE: source,
      CMDABL_RS_TARGET: target,
    }),
  });

  return stepOf(result);
}

const WIN_REMOTE_SCRIPTS_DIR = path.join(
  process.env["USERPROFILE"] ?? "",
  "Documents\\Ableton\\User Library\\Remote Scripts",
);

function runWinRemoteScriptSetup(): StepResult {
  const source = remoteScriptSourcePath();
  const target = path.join(WIN_REMOTE_SCRIPTS_DIR, "cmdAbl");
  if (isSameDirectory(source, target)) return { ok: true, text: linkedRemoteScriptMessage(source) };

  const script = `
if (-not (Test-Path $env:CMDABL_RS_SOURCE)) {
  Write-Output "ERROR: Remote Script source not found at $env:CMDABL_RS_SOURCE"
  exit 1
}
New-Item -ItemType Directory -Force -Path $env:CMDABL_RS_TARGET | Out-Null
Copy-Item -Path (Join-Path $env:CMDABL_RS_SOURCE '*') -Destination $env:CMDABL_RS_TARGET -Recurse -Force
Write-Output "OK: Remote Script installed to $env:CMDABL_RS_TARGET"
`.trim();

  const result = spawnSync("powershell", ["-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: childEnv({
      CMDABL_RS_SOURCE: source,
      CMDABL_RS_TARGET: target,
    }),
  });

  return stepOf(result);
}

/** Copy (or update) the Remote Script into Live's User Library. Never throws. */
export function runRemoteScriptSetup(): StepResult {
  if (process.platform === "darwin") return runMacRemoteScriptSetup();
  if (process.platform === "win32") return runWinRemoteScriptSetup();
  return { ok: false, text: "Unsupported platform." };
}

// ── Karabiner variable ───────────────────────────────────────────────────────

export function setKarabinerPaletteOpen(open: boolean): void {
  if (process.platform !== "darwin") return;
  try {
    const value = JSON.stringify({ cmdabl_open: open ? 1 : 0 });
    const script = `
for cli in /opt/homebrew/bin/karabiner_cli "/Library/Application Support/org.pqrs/Karabiner-Elements/bin/karabiner_cli"; do
  if [ -x "$cli" ]; then
    "$cli" --set-variables '${value}' 2>/dev/null && exit 0
  fi
done
`.trim();
    const child = spawn("bash", ["-c", script], { stdio: "ignore", env: childEnv() });
    child.on("error", () => {}); // non-critical; an unhandled "error" event would take down the host
    child.unref();
  } catch {
    // non-critical
  }
}

// ── Platform dispatchers ─────────────────────────────────────────────────────

export function isSetupDone(): boolean {
  if (process.platform === "darwin") return isKarabinerSetupDone();
  if (process.platform === "win32") return isAhkSetupDone();
  return false;
}

/** The docs site; every setup step ends with a plain URL line to its section. */
export const DOCS_BASE_URL = "https://marvinhauke.github.io/cmdAbl/";
export const KEYBOARD_DOCS_URL = `${DOCS_BASE_URL}getting-started/#2-check-the-setup-page`;
export const REMOTE_SCRIPT_DOCS_URL = `${DOCS_BASE_URL}getting-started/#3-turn-on-the-remote-script-in-live`;
