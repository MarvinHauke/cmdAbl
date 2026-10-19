import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SCRIPT_VERSION } from "./bridgeProtocol.js";

// Is the Remote Script installed, and is it the version this extension expects?
// Assumption (0001 §3): macOS default User Library location. The location is
// configurable in Live, and the INSTALLED Extension Host is sandboxed (Node's permission model:
// it may read only the Extensions / Extensions Data trees and its temp folder, measured
// 2026-10-19), so there this always ends in "unknown". Every failure to look is "unknown" —
// never an error — and the "not running" text (which claims neither "not installed" nor
// "outdated") is then the honest one. `npm start` (unsandboxed host) can still see the folder.

export type InstalledScript =
  | { status: "missing" } // folder not found in the default location
  | { status: "outdated"; version: string | null } // present, no VERSION line or one that differs from this extension's
  | { status: "current"; version: string }
  | { status: "unknown" }; // cannot tell (other platform, unreadable)

export function defaultScriptFile(home = os.homedir()): string {
  return path.join(home, "Music/Ableton/User Library/Remote Scripts/cmdAbl/cmdabl.py");
}

/** `VERSION = "x.y.z"` from the script's protocol.py text. */
export function parseScriptVersion(text: string): string | null {
  const m = /^VERSION\s*=\s*["']([^"']+)["']/m.exec(text);
  return m ? m[1]! : null;
}

/** Only ENOENT means absent; a blocked read (sandbox, permissions) is "unknown". */
function probeFile(file: string): "present" | "absent" | "unknown" {
  try {
    fs.statSync(file);
    return "present";
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unknown";
  }
}

export function inspectInstalledScript(
  platform: string = process.platform,
  read: (file: string) => string | null = (f) => {
    try {
      return fs.readFileSync(f, "utf8");
    } catch {
      return null;
    }
  },
  probe: (file: string) => "present" | "absent" | "unknown" = probeFile,
  home?: string,
): InstalledScript {
  if (platform !== "darwin") return { status: "unknown" };
  try {
    const main = defaultScriptFile(home);
    const dir = path.dirname(main);
    const folder = probe(dir);
    if (folder === "absent") return { status: "missing" };
    if (folder === "unknown") return { status: "unknown" };
    // The version lives in protocol.py; today's script (0.0.x) has no such file.
    const text = read(path.join(dir, "protocol.py"));
    if (text === null) {
      return probe(main) === "present" ? { status: "outdated", version: null } : { status: "unknown" };
    }
    const version = parseScriptVersion(text);
    if (version === SCRIPT_VERSION) return { status: "current", version };
    return { status: "outdated", version };
  } catch {
    return { status: "unknown" };
  }
}
