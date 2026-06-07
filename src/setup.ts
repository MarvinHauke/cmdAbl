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

// ── Remote Script bridge ─────────────────────────────────────────────────────
// Copies the companion Remote Script (which enables track selection) into Live's
// User Library. Selecting it as a Control Surface and restarting Live can't be
// automated — Live has no API for either — so we just install the files.

function remoteScriptSourcePath(): string {
  return path.resolve(__dirname, "../remote-script/cmdAbl");
}

const MAC_REMOTE_SCRIPTS_DIR = path.join(
  process.env["HOME"] ?? "~",
  "Music/Ableton/User Library/Remote Scripts",
);

function runMacRemoteScriptSetup(): string {
  const source = remoteScriptSourcePath();
  const target = path.join(MAC_REMOTE_SCRIPTS_DIR, "cmdAbl");

  const script = `
if [ ! -d "$CMDABL_RS_SOURCE" ]; then
  echo "ERROR: Remote Script source not found at $CMDABL_RS_SOURCE"
  exit 1
fi
mkdir -p "$CMDABL_RS_TARGET"
cp -R "$CMDABL_RS_SOURCE"/. "$CMDABL_RS_TARGET"/
echo "OK: Remote Script installed to $CMDABL_RS_TARGET"
echo "Next: restart Live, then Settings -> Link, Tempo & MIDI -> Control Surface -> cmdAbl"
`.trim();

  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      CMDABL_RS_SOURCE: source,
      CMDABL_RS_TARGET: target,
    },
  });

  return ((result.stdout ?? "") + (result.stderr ?? "")).trim() || "Setup complete.";
}

const WIN_REMOTE_SCRIPTS_DIR = path.join(
  process.env["USERPROFILE"] ?? "",
  "Documents\\Ableton\\User Library\\Remote Scripts",
);

function runWinRemoteScriptSetup(): string {
  const source = remoteScriptSourcePath();
  const target = path.join(WIN_REMOTE_SCRIPTS_DIR, "cmdAbl");

  const script = `
if (-not (Test-Path $env:CMDABL_RS_SOURCE)) {
  Write-Output "ERROR: Remote Script source not found at $env:CMDABL_RS_SOURCE"
  exit 1
}
New-Item -ItemType Directory -Force -Path $env:CMDABL_RS_TARGET | Out-Null
Copy-Item -Path (Join-Path $env:CMDABL_RS_SOURCE '*') -Destination $env:CMDABL_RS_TARGET -Recurse -Force
Write-Output "OK: Remote Script installed to $env:CMDABL_RS_TARGET"
Write-Output 'Next: restart Live, then Settings -> Link, Tempo & MIDI -> Control Surface -> cmdAbl'
`.trim();

  const result = spawnSync("powershell", ["-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      CMDABL_RS_SOURCE: source,
      CMDABL_RS_TARGET: target,
    },
  });

  return ((result.stdout ?? "") + (result.stderr ?? "")).trim() || "Setup complete.";
}

function runRemoteScriptSetup(): string {
  if (process.platform === "darwin") return runMacRemoteScriptSetup();
  if (process.platform === "win32") return runWinRemoteScriptSetup();
  return "Unsupported platform.";
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
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return "Unsupported platform — only macOS and Windows are supported.";
  }
  const keyboard = process.platform === "darwin" ? runKarabinerSetup() : runAhkSetup();
  return [
    "— Keyboard trigger —",
    keyboard,
    "",
    "— Remote Script bridge —",
    runRemoteScriptSetup(),
  ].join("\n");
}
