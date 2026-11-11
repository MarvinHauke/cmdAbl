import { spawn as nodeSpawn, execFile as nodeExecFile, type ChildProcess } from "node:child_process";
import { childEnv } from "./childEnv.js";
import { ok, fail, ExitCode, type CommandResult } from "../types.js";

// "Restart Live" on the setup page (macOS only): quit the Live cmdAbl runs in the normal way (an Apple Event `quit`, so Live
// asks "Save changes?" itself), and have a detached helper start it again once that process is gone. Never a kill. Every
// value that reaches a child is an argument (argv), never part of a script text.

/** `…/<Name>.app/Contents/Helpers/ExtensionHost/node` → `…/<Name>.app`, or null when this process does not run inside an app bundle. */
export function appPathFromExecPath(execPath: string): string | null {
  const m = /^(\/.*?\.app)\/Contents\//.exec(execPath);
  return m ? m[1]! : null;
}

/** The pid of the process whose command is exactly `<app>/Contents/MacOS/Live` (only option arguments such as -psn_ may follow), from `ps -axo pid=,command=` output. */
export function findLivePid(psOutput: string, appPath: string): number | null {
  const exe = `${appPath}/Contents/MacOS/Live`;
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[2]!;
    if (command === exe || command.startsWith(`${exe} -`)) return Number(m[1]);
  }
  return null;
}

/** The helper: waits (up to ~120 s) for the pid to exit, then opens the app. `$1` = app path, `$2` = pid. If the save dialog was cancelled, Live keeps running and nothing happens. */
export const HELPER_SCRIPT = [
  'n=0',
  'while kill -0 "$2" 2>/dev/null; do',
  '  n=$((n+1))',
  '  [ "$n" -gt 240 ] && exit 0',
  '  sleep 0.5',
  'done',
  'sleep 1',
  'exec /usr/bin/open "$1"',
].join("\n");

/** argv of the helper: `/bin/sh -c <script> sh <app> <pid>`. */
export function helperArgs(appPath: string, pid: number): string[] {
  return ["-c", HELPER_SCRIPT, "sh", appPath, String(pid)];
}

/** argv of osascript: the app path is passed in as an argument, not written into the script. */
export function quitArgs(appPath: string): string[] {
  return ["-e", "on run argv", "-e", "tell application (item 1 of argv) to quit", "-e", "end run", appPath];
}

export interface RestartDeps {
  platform?: string;
  execPath?: string;
  spawn?: (command: string, args: string[], options: { detached?: boolean; stdio: "ignore" | ["ignore", "ignore", "pipe"]; env: Record<string, string> }) => ChildProcess;
  /** `ps -axo pid=,command=` output. */
  listProcesses?: () => Promise<string>;
  /** How long a still-running osascript counts as "asked, Live is showing its dialog". */
  graceMs?: number;
}

function listProcesses(): Promise<string> {
  return new Promise((resolve, reject) => {
    nodeExecFile("/bin/ps", ["-axo", "pid=,command="], { env: childEnv(), maxBuffer: 16 * 1024 * 1024, timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

function spawned(child: ChildProcess): Promise<string | null> {
  return new Promise((resolve) => {
    child.once("error", (e) => resolve(e.message));
    child.once("spawn", () => resolve(null));
  });
}

/** Quit Live the normal way and start it again afterwards. Never throws. */
export async function restartLive(deps: RestartDeps = {}): Promise<CommandResult> {
  try {
    if ((deps.platform ?? process.platform) !== "darwin") return fail(ExitCode.UNAVAILABLE, "restart: restarting Live from here works on macOS only; restart it by hand");
    const app = appPathFromExecPath(deps.execPath ?? process.execPath);
    if (!app) return fail(ExitCode.UNAVAILABLE, "restart: cmdAbl does not run inside a Live app bundle; restart Live by hand");
    const spawn = deps.spawn ?? nodeSpawn;
    const pid = findLivePid(await (deps.listProcesses ?? listProcesses)(), app);
    if (pid === null) return fail(ExitCode.NOT_FOUND, `restart: could not find the running Live (${app}); restart it by hand`);

    // 1. The helper first: it must be waiting before Live starts to quit.
    const helper = spawn("/bin/sh", helperArgs(app, pid), { detached: true, stdio: "ignore", env: childEnv() });
    const helperErr = await spawned(helper);
    if (helperErr !== null) return fail(ExitCode.FAILURE, `restart: cannot start the helper: ${helperErr}`);
    helper.unref();

    // 2. Ask Live to quit. A save dialog keeps osascript waiting, so a command still running after the grace time is a good sign.
    const stopHelper = (): void => {
      try {
        if (helper.pid !== undefined) process.kill(helper.pid); // nothing is quitting: the helper must not restart Live later
      } catch {
        /* already gone */
      }
    };
    const abort = (text: string): CommandResult => {
      stopHelper();
      return fail(ExitCode.FAILURE, text);
    };
    const quit = spawn("/usr/bin/osascript", quitArgs(app), { stdio: ["ignore", "ignore", "pipe"], env: childEnv() });
    // Also after the grace time: a cancelled save dialog ends osascript with an error later, and then nothing quits, so the helper must go.
    quit.on("exit", (code) => {
      if (code !== 0 && helper.pid !== undefined) {
        try {
          process.kill(helper.pid);
        } catch {
          /* already gone */
        }
      }
    });
    let stderr = "";
    quit.stderr?.on("data", (d: Buffer | string) => (stderr += String(d)));
    const outcome = await new Promise<{ error?: string; code?: number | null; running?: true }>((resolve) => {
      const timer = setTimeout(() => resolve({ running: true }), deps.graceMs ?? 3000);
      quit.once("error", (e) => (clearTimeout(timer), resolve({ error: e.message })));
      // 'close' fires after osascript's stdio has ended, so its whole stderr is in (no timer needed, unlike 'exit').
      quit.once("close", (code) => (clearTimeout(timer), resolve({ code })));
    });
    if (outcome.error !== undefined) return abort(`restart: cannot ask Live to quit: ${outcome.error}`);
    if (outcome.code !== undefined && outcome.code !== 0) {
      const why = stderr.trim();
      // Cancel in Live's save dialog is the user's choice, not a failure: Live stays open and the helper must not restart it.
      if (why.includes("(-128)")) {
        stopHelper();
        return ok("Restart cancelled; Live stays open.");
      }
      if (why.includes("(-1743)")) {
        return abort("restart: macOS did not allow cmdAbl to control Live. Allow it in System Settings → Privacy & Security → Automation, then try again.");
      }
      return abort(`restart: Live did not accept the quit request${why ? `: ${why}` : ` (exit ${outcome.code})`}`);
    }
    return ok("Live is asked to quit; it starts again after you answer its save dialog.");
  } catch (e: unknown) {
    return fail(ExitCode.FAILURE, `restart: ${e instanceof Error ? e.message : String(e)}`);
  }
}
