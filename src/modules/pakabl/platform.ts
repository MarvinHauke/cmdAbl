import * as path from "node:path";
import { spawnSync } from "node:child_process";

// ── Live's Extensions folder ─────────────────────────────────────────────────
// Where Live scans for installed `.ablx` bundles — confirmed on macOS (the user
// has manually placed an extension there and Live loads it); the Windows path
// is the user's best guess and may need adjusting once verified in practice.

const MAC_EXTENSIONS_DIR = path.join(
  process.env["HOME"] ?? "~",
  "Library/Application Support/Ableton/Extensions",
);

const WIN_EXTENSIONS_DIR = path.join(
  process.env["APPDATA"] ?? "",
  "Ableton/Live Extensions",
);

export const EXTENSIONS_DIR = process.platform === "win32" ? WIN_EXTENSIONS_DIR : MAC_EXTENSIONS_DIR;

function run(mac: string, win: string, env: Record<string, string>): { ok: boolean; output: string } {
  const result =
    process.platform === "win32"
      ? spawnSync("powershell", ["-NonInteractive", "-Command", win], { encoding: "utf8", env: { ...process.env, ...env } })
      : spawnSync("bash", ["-c", mac], { encoding: "utf8", env: { ...process.env, ...env } });

  return {
    ok: result.status === 0,
    output: ((result.stdout ?? "") + (result.stderr ?? "")).trim(),
  };
}

// ── open URL ─────────────────────────────────────────────────────────────────
// `open` ships with macOS; `Start-Process` is a PowerShell built-in — same
// "shell out, no new dependency" approach as the rest of this module.

export function openUrl(url: string): void {
  run(`open "$CMDABL_URL"`, `Start-Process $env:CMDABL_URL`, { CMDABL_URL: url });
}

// ── download ─────────────────────────────────────────────────────────────────
// curl ships with macOS/Linux; Invoke-WebRequest is built into PowerShell —
// no new dependency, same "shell out" approach setup.ts already established.

export function downloadFile(url: string, destPath: string): { ok: boolean; output: string } {
  return run(
    `mkdir -p "$(dirname "$CMDABL_DEST")" && curl -fsSL "$CMDABL_URL" -o "$CMDABL_DEST"`,
    `New-Item -ItemType Directory -Force -Path (Split-Path $env:CMDABL_DEST) | Out-Null
Invoke-WebRequest -Uri $env:CMDABL_URL -OutFile $env:CMDABL_DEST`,
    { CMDABL_URL: url, CMDABL_DEST: destPath },
  );
}

// ── unzip ────────────────────────────────────────────────────────────────────
// `-o`/`-Force` make both idempotent — safe to re-run for upgrades, overwriting
// an existing install in place (mirrors `cp -R` in runMacRemoteScriptSetup).

export function unzipInto(archivePath: string, destDir: string): { ok: boolean; output: string } {
  return run(
    `mkdir -p "$CMDABL_DEST" && unzip -o "$CMDABL_ARCHIVE" -d "$CMDABL_DEST"`,
    `New-Item -ItemType Directory -Force -Path $env:CMDABL_DEST | Out-Null
Expand-Archive -Path $env:CMDABL_ARCHIVE -DestinationPath $env:CMDABL_DEST -Force`,
    { CMDABL_ARCHIVE: archivePath, CMDABL_DEST: destDir },
  );
}

// ── remove directory ─────────────────────────────────────────────────────────
// Used by `pakabl uninstall` to delete an installed extension's folder —
// `rm -rf`/`Remove-Item -Recurse -Force` are idempotent (safe even if the
// path is already gone).

export function removeDir(dirPath: string): { ok: boolean; output: string } {
  return run(
    `rm -rf "$CMDABL_DIR"`,
    `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path $env:CMDABL_DIR`,
    { CMDABL_DIR: dirPath },
  );
}

// ── plain-text file read ─────────────────────────────────────────────────────
// Used for the cached curated index and for reading an installed extension's
// manifest.json. Shelled out (not node:fs) to stay consistent with setup.ts's
// established pattern. Writing the index is handled by `downloadFile` itself
// (curl/Invoke-WebRequest write straight to the destination path).

function readTextFile(filePath: string): string | undefined {
  const { ok, output } =
    process.platform === "win32"
      ? run("", `if (Test-Path $env:CMDABL_PATH) { Get-Content -Raw $env:CMDABL_PATH }`, { CMDABL_PATH: filePath })
      : run(`[ -f "$CMDABL_PATH" ] && cat "$CMDABL_PATH"`, "", { CMDABL_PATH: filePath });
  return ok && output ? output : undefined;
}

export function readJsonFile<T>(filePath: string): T | undefined {
  const text = readTextFile(filePath);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
