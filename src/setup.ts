import * as path from "node:path";
import { spawnSync, spawn } from "node:child_process";

// ── macOS / Karabiner-Elements ───────────────────────────────────────────────

const KARABINER_APP = "/Applications/Karabiner-Elements.app";
const KARABINER_MODS_DIR = path.join(
  process.env["HOME"] ?? "~",
  ".config/karabiner/assets/complex_modifications",
);
const KARABINER_SYMLINK_NAME = "cmdabl.json";

function karabinerSourcePath(): string {
  return path.resolve(__dirname, "../karabiner/cmdabl.json");
}

function isKarabinerSetupDone(): boolean {
  try {
    const target = path.join(KARABINER_MODS_DIR, KARABINER_SYMLINK_NAME);
    const result = spawnSync("bash", ["-c", `test -e "${target}"`], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function runKarabinerSetup(): string {
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
echo "Next: Karabiner-Elements -> Complex Modifications -> Add rule -> enable cmdAbl"
`.trim();

  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      CMDABL_APP: KARABINER_APP,
      CMDABL_SOURCE: source,
      CMDABL_TARGET: target,
      CMDABL_MODS_DIR: KARABINER_MODS_DIR,
    },
  });

  return ((result.stdout ?? "") + (result.stderr ?? "")).trim() || "Setup complete.";
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

function isAhkSetupDone(): boolean {
  try {
    const target = path.join(WIN_STARTUP_DIR, WIN_SCRIPT_NAME);
    const result = spawnSync(
      "powershell",
      ["-NonInteractive", "-Command", `Test-Path '${target}'`],
      { encoding: "utf8" },
    );
    return result.stdout?.trim() === "True";
  } catch {
    return false;
  }
}

function runAhkSetup(): string {
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
    env: {
      ...process.env,
      CMDABL_SOURCE: source,
      CMDABL_TARGET: target,
      CMDABL_STARTUP_DIR: WIN_STARTUP_DIR,
    },
  });

  return ((result.stdout ?? "") + (result.stderr ?? "")).trim() || "Setup complete.";
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
    spawn("bash", ["-c", script], { stdio: "ignore" }).unref();
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

export function runSetup(): string {
  if (process.platform === "darwin") return runKarabinerSetup();
  if (process.platform === "win32") return runAhkSetup();
  return "Unsupported platform — only macOS and Windows are supported.";
}
