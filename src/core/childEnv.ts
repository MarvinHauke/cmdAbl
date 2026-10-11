// The environment handed to child processes (bash, powershell, curl, unzip,
// open, karabiner_cli, …). Never the whole `process.env`: users export secrets
// (API keys, tokens) in their shells and a child must not inherit them. Only
// an allowlist passes; callers add what they need through `extra` — that is
// also the only way a CMDABL_* value gets in, so a stale exported one is never used.
// Pure and dependency-free, so any module can use it.

// Exact names on POSIX; matched case-insensitively on Windows.
const BASE_NAMES = [
  // POSIX
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG",
  // Windows
  "PATHEXT", "SystemRoot", "SystemDrive", "windir", "ComSpec", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "USERNAME", "APPDATA", "LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramData",
  // PowerShell / .NET look these up when starting.
  "PSModulePath", "PROCESSOR_ARCHITECTURE",
];

// Networking: curl behind a proxy or a corporate CA. Both cases are common on
// every platform. A proxy URL may carry credentials — the user opted in by
// configuring it for their tools, but nothing else about the network passes.
const NETWORK_NAMES = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE",
];

const BASE = new Set(BASE_NAMES);
const NETWORK_FOLD = new Set(NETWORK_NAMES.map((n) => n.toLowerCase()));
const BASE_FOLD = new Set(BASE_NAMES.map((n) => n.toLowerCase()));

function allowed(name: string, windows: boolean): boolean {
  const lower = name.toLowerCase();
  if (NETWORK_FOLD.has(lower)) return true;
  if (windows ? BASE_FOLD.has(lower) : BASE.has(name)) return true;
  return !windows && name.startsWith("LC_");
}

export function childEnv(
  extra: Record<string, string> = {},
  source: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): Record<string, string> {
  const windows = platform === "win32";
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && allowed(name, windows)) env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (windows) {
      // Windows names are case-insensitive: the explicit value replaces any casing.
      for (const existing of Object.keys(env)) {
        if (existing.toLowerCase() === name.toLowerCase()) delete env[existing];
      }
    }
    env[name] = value;
  }
  return env;
}
