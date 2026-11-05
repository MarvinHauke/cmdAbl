import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { childEnv } from "./childEnv.js";
import { ok, fail, ExitCode, type CommandResult } from "./types.js";

/**
 * A plain string check, no `URL` global (the Extension Host's globals are not
 * guaranteed): `https://`, a host that starts with a letter or digit, and no
 * whitespace, control, quote, angle-bracket, backtick or backslash characters.
 */
export function isHttpsUrl(url: string): boolean {
  return /^https:\/\/[A-Za-z0-9][^\s\x00-\x1f\x7f"'<>`\\]*$/.test(url);
}

/**
 * The one non-https link cmdAbl opens: Karabiner's rule import (plan 0021 §3), `karabiner://…/import?url=<percent-encoded address>`.
 * The address is encoded to letters, digits and `%._~-`, so nothing else can ride along.
 */
export function isKarabinerImportUrl(url: string): boolean {
  return /^karabiner:\/\/karabiner\/assets\/complex_modifications\/import\?url=[A-Za-z0-9%._~-]+$/.test(url);
}

/**
 * Open a URL in the default browser. Only `https:` URLs are accepted. Only
 * macOS has a launcher we can rely on (`open`); elsewhere the URL is handed to
 * the user (exit 5). A launch that fails is a result, never an unhandled
 * "error" event, which would take down the whole Extension Host.
 */
export function openUrl(
  url: string,
  deps: {
    platform?: string;
    spawn?: (command: string, args: string[], options: { detached: boolean; stdio: "ignore"; env: Record<string, string> }) => ChildProcess;
  } = {},
): Promise<CommandResult> {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? nodeSpawn;

  if (!isHttpsUrl(url) && !isKarabinerImportUrl(url)) {
    return Promise.resolve(fail(ExitCode.FAILURE, `refusing to open "${url}": not a plain https:// URL`));
  }
  if (platform !== "darwin") {
    return Promise.resolve(fail(ExitCode.UNAVAILABLE, `cannot open a browser here; open it by hand: ${url}`));
  }
  return new Promise((resolve) => {
    try {
      const child = spawn("open", [url], { detached: true, stdio: "ignore", env: childEnv() });
      child.once("error", (e) => resolve(fail(ExitCode.FAILURE, `cannot open ${url}: ${e.message}`)));
      child.once("spawn", () => {
        child.unref();
        resolve(ok());
      });
    } catch (e: unknown) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      resolve(fail(ExitCode.FAILURE, `cannot open ${url}: ${reason}`));
    }
  });
}
