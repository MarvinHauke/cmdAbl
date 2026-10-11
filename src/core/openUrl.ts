import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { childEnv } from "./childEnv.js";
import { ok, fail, ExitCode, type CommandResult } from "../types.js";

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

  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (!parsed || parsed.protocol !== "https:") {
    return Promise.resolve(fail(ExitCode.FAILURE, `refusing to open "${url}": only https: URLs are opened`));
  }
  if (platform !== "darwin") {
    return Promise.resolve(fail(ExitCode.UNAVAILABLE, `cannot open a browser here; open it by hand: ${url}`));
  }
  return new Promise((resolve) => {
    try {
      const child = spawn("open", [parsed.href], { detached: true, stdio: "ignore", env: childEnv() });
      child.once("error", (e) => resolve(fail(ExitCode.FAILURE, `cannot open ${url}: ${e.message}`)));
      child.once("spawn", () => {
        child.unref();
        resolve(ok());
      });
    } catch (e: unknown) {
      resolve(fail(ExitCode.FAILURE, `cannot open ${url}: ${e instanceof Error ? e.message : String(e)}`));
    }
  });
}
