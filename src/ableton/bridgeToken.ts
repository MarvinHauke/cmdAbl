import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "../core/log.js";
import { TEXT_NO_WRITES, fail, textNoToken, type BridgeResult } from "./bridgeProtocol.js";

// The access token for writing operations (0001 §9). The Remote Script creates
// it at start and writes it to a file only the user can read, outside the
// repository in every setup, inside the extension's own data folder: the installed
// Extension Host runs sandboxed and may read only the Extensions / Extensions Data
// trees (and its temp folder). This module only *reads* it, lazily, and keeps it
// in memory. The value is never logged, never put in an error text and never
// written anywhere.

/** The extension's id: lower-case author + "." + name from manifest.json (a test checks it). */
export const EXTENSION_ID = "marvinhauke.cmdabl";

export function tokenFilePath(home: string = os.homedir()): string {
  return path.join(home, "Library", "Application Support", "Ableton", "Extensions Data", EXTENSION_ID, "bridge-token");
}

export interface TokenSource {
  /** The token, or exit code 5 with the reason (not macOS, unreadable, malformed). Never throws. */
  get(): BridgeResult<string>;
  /** Drop the cached value so the next `get()` reads the file again (after `forbidden`). */
  forget(): void;
}

export interface TokenSourceOptions {
  platform?: string;
  home?: string;
  read?: (file: string) => string;
  /** One line per distinct failure (error code only, never the file's content). Default: the extension log. */
  log?: (line: string) => void;
}

const tokenLog = logger("bridge");
const SHAPE = /^[0-9a-f]{32}$/;

export function createTokenSource(options: TokenSourceOptions = {}): TokenSource {
  const platform = options.platform ?? process.platform;
  const read = options.read ?? ((file: string) => fs.readFileSync(file, "utf8"));
  const log = options.log ?? ((line: string) => tokenLog.warn(line));
  let cached: string | null = null;
  let lastReason = "";
  /** Say why a read failed, once per reason: the error code (ENOENT, EACCES, …) or "wrong shape". */
  const note = (reason: string): void => {
    if (reason === lastReason) return;
    lastReason = reason;
    try {
      log(`bridge token: cannot read (${reason})`);
    } catch {
      // logging must never turn a refusal into a throw
    }
  };
  return {
    get() {
      if (platform !== "darwin") return fail(5, TEXT_NO_WRITES);
      if (cached) return { ok: true, value: cached };
      try {
        const value = read(tokenFilePath(options.home)).trim();
        if (!SHAPE.test(value)) {
          note("wrong shape");
          return fail(5, textNoToken("wrong shape"));
        }
        lastReason = "";
        cached = value;
        return { ok: true, value };
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | null)?.code;
        const reason = typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "error";
        note(reason);
        return fail(5, textNoToken(reason));
      }
    },
    forget() {
      cached = null;
    },
  };
}
