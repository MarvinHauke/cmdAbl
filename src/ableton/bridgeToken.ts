import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TEXT_NO_TOKEN, TEXT_NO_WRITES, fail, type BridgeResult } from "./bridgeProtocol.js";

// The access token for writing operations (0001 §9). The Remote Script creates
// it at start and writes it to a file only the user can read, outside the
// repository in every setup. This module only *reads* it, lazily, and keeps it
// in memory. The value is never logged, never put in an error text and never
// written anywhere.

export function tokenFilePath(home: string = os.homedir()): string {
  return path.join(home, "Library", "Application Support", "cmdAbl", "bridge-token");
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
}

const SHAPE = /^[0-9a-f]{32}$/;

export function createTokenSource(options: TokenSourceOptions = {}): TokenSource {
  const platform = options.platform ?? process.platform;
  const read = options.read ?? ((file: string) => fs.readFileSync(file, "utf8"));
  let cached: string | null = null;
  return {
    get() {
      if (platform !== "darwin") return fail(5, TEXT_NO_WRITES);
      if (cached) return { ok: true, value: cached };
      try {
        const value = read(tokenFilePath(options.home)).trim();
        if (!SHAPE.test(value)) return fail(5, TEXT_NO_TOKEN);
        cached = value;
        return { ok: true, value };
      } catch {
        return fail(5, TEXT_NO_TOKEN);
      }
    },
    forget() {
      cached = null;
    },
  };
}
