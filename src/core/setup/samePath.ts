import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { childEnv } from "./childEnv.js";

// The installed extension runs in a sandboxed Extension Host (Node --permission):
// it may read only its own Extensions / Extensions Data trees, so `realpathSync`
// on the User Library or the repository throws ERR_ACCESS_DENIED. Child processes
// are allowed, so a denied read falls back to the shell's `test -ef` (same file).

/** True for the errors a sandbox or file permission raises (as opposed to "does not exist"). */
function isDenied(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code === "ERR_ACCESS_DENIED" || code === "EACCES" || code === "EPERM";
}

/** `test a -ef b` in a child process (macOS / Linux); false on any failure. Paths travel in variables, not in the script. */
export function sameFileViaShell(a: string, b: string): boolean {
  try {
    const result = spawnSync("bash", ["-c", 'test -e "$CMDABL_A" && test "$CMDABL_A" -ef "$CMDABL_B"'], {
      stdio: "ignore",
      env: childEnv({ CMDABL_A: a, CMDABL_B: b }),
      timeout: 2000, // a stuck network mount must not block the host thread (setup runs synchronously)
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * True when both paths exist and resolve to the same real location (e.g. the
 * User Library's Remote Script folder is a symlink to the repository's).
 * Never throws: a path that cannot be resolved is simply "not the same". When
 * the read is denied (installed, sandboxed) the comparison is made by a child
 * process instead (not on Windows, where it stays "not the same").
 */
export function isSameDirectory(
  a: string,
  b: string,
  realpath: (p: string) => string = realpathSync,
  viaShell: (a: string, b: string) => boolean = sameFileViaShell,
  platform: string = process.platform,
): boolean {
  try {
    return realpath(a) === realpath(b);
  } catch (e) {
    return isDenied(e) && platform !== "win32" ? viaShell(a, b) : false;
  }
}
