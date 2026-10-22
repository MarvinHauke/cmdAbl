import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The desktop side of the cmdAbl MCP server (plan 0016 §5): bring Live to the front, type or press
// one allowed key, and capture ONE Live window to captures/<name>.png (gitignored). It never
// captures the full screen and never touches a window Live does not own. The OS calls go through an
// injectable runner (execFile with an argument list, never a shell string); tests use a fake.

export const LIVE_BUNDLE_ID = "com.ableton.live"; // the Beta and the Suite share it
const LIVE_PROCESS = "Live"; // the owner name of Live's windows (both builds)
const MAX_TEXT = 200;
const NAME = /^[a-z0-9-]{1,60}$/;

/** The one thing the OS layer needs: run a program with arguments and get its output. */
export type Runner = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const defaultRunner: Runner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) + (error && !stderr ? error.message : "") });
    });
  });

export interface Answer {
  text: string;
  isError: boolean;
}
const ok = (text: string): Answer => ({ text, isError: false });
const bad = (text: string): Answer => ({ text, isError: true });

// ── keys ────────────────────────────────────────────────────────────────────────────────────

/** What one allowed key does through System Events: a key code, or a character with a modifier. */
export type KeySpec = { code: number } | { char: string; using: string };

/** The keys cmdabl_keys may press. They reach Live only while a cmdAbl dialog is in front (see `guardedScript`). */
export const KEYS: Readonly<Record<string, KeySpec>> = {
  escape: { code: 53 },
  return: { code: 36 },
  tab: { code: 48 },
  up: { code: 126 },
  down: { code: 125 },
  left: { code: 123 },
  right: { code: 124 },
  delete: { code: 51 },
  space: { code: 49 },
  "cmd+s": { char: "s", using: "command down" },
  "cmd+z": { char: "z", using: "command down" },
};

/** Printable text that is safe to hand to the script (JSON-quoted there); null otherwise. */
export function typableText(text: string): string | null {
  if (text.length === 0 || text.length > MAX_TEXT) return null;
  if (/[\x00-\x1f\x7f]/.test(text)) return null; // no control characters: use the key list for return/tab
  return text;
}

/**
 * The rule "a cmdAbl dialog is in front", on Live's on-screen windows front to back: the topmost
 * window is not the largest one (the main window). As plain JavaScript source, so the very same
 * code runs inside the JXA script and in the tests.
 */
export const FRONT_IS_DIALOG_SRC = `function frontIsDialog(ws) {
  if (!ws.length) return false;
  var area = function (w) { return w.width * w.height; };
  var main = ws[0];
  for (var i = 1; i < ws.length; i++) if (area(ws[i]) > area(main)) main = ws[i];
  return ws[0].id !== main.id && area(ws[0]) < area(main);
}`;
export const frontIsDialog = new Function(`${FRONT_IS_DIALOG_SRC}; return frontIsDialog;`)() as (ws: Array<{ id: number; width: number; height: number }>) => boolean;

/**
 * ONE script that checks and types: Live must be the frontmost app AND its frontmost window a
 * cmdAbl dialog, checked right before the keystrokes in the same process, so a click elsewhere
 * between a check and a keystroke cannot send them to another app. Answers JSON:
 * `{"sent":true}` or `{"sent":false,"reason":"not-frontmost"|"no-dialog"}`.
 */
export function guardedScript(input: { text?: string; key?: KeySpec }): string {
  const actions: string[] = [];
  if (input.text !== undefined) actions.push(`se.keystroke(${JSON.stringify(input.text)});`);
  if (input.key) {
    actions.push("code" in input.key ? `se.keyCode(${input.key.code});` : `se.keystroke(${JSON.stringify(input.key.char)}, { using: ${JSON.stringify(input.key.using)} });`);
  }
  return `
ObjC.import('CoreGraphics');
${FRONT_IS_DIALOG_SRC}
var se = Application('System Events');
var front = se.processes.whose({ frontmost: true })[0].bundleIdentifier();
var out;
if (front !== ${JSON.stringify(LIVE_BUNDLE_ID)}) {
  out = { sent: false, reason: 'not-frontmost' };
} else {
  var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID)));
  var ws = all.filter(function (w) { return w.kCGWindowOwnerName === ${JSON.stringify(LIVE_PROCESS)} && w.kCGWindowBounds.Width >= 100 && w.kCGWindowBounds.Height >= 60 && w.kCGWindowAlpha !== 0; })
    .map(function (w) { return { id: w.kCGWindowNumber, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height }; });
  if (!frontIsDialog(ws)) {
    out = { sent: false, reason: 'no-dialog' };
  } else {
    ${actions.join(" ")}
    out = { sent: true };
  }
}
JSON.stringify(out);
`;
}

const ACCESSIBILITY =
  "Accessibility is not allowed for this terminal app. Grant it in System Settings → Privacy & Security → Accessibility (add the terminal app that runs Claude Code), then try again.";
const AUTOMATION =
  'macOS asked to allow control of "System Events" and it was refused. Allow it in System Settings → Privacy & Security → Automation (terminal app → System Events), then try again.';

function osaProblem(stderr: string): string {
  if (/-1719|-25211|not allowed assistive|assistive access/i.test(stderr)) return ACCESSIBILITY;
  if (/-1743|not authorized to send apple events/i.test(stderr)) return AUTOMATION;
  return `osascript failed: ${stderr.trim().split("\n")[0]?.slice(0, 200) ?? "unknown error"}`;
}

// ── windows ─────────────────────────────────────────────────────────────────────────────────

export interface LiveWindow {
  id: number;
  name: string;
  width: number;
  height: number;
}

/** The JXA program that lists Live's on-screen windows, front to back, as JSON. */
export const WINDOW_LIST_SCRIPT = `
ObjC.import('CoreGraphics');
var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID)));
JSON.stringify(all.filter(function (w) { return w.kCGWindowOwnerName === ${JSON.stringify(LIVE_PROCESS)}; }).map(function (w) {
  return { id: w.kCGWindowNumber, name: w.kCGWindowName || '', width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height, alpha: w.kCGWindowAlpha };
}));
`;

/** Parse the script's output; windows that are invisible or too small to be a real window are dropped. */
export function parseWindowList(stdout: string): LiveWindow[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const out: LiveWindow[] = [];
  for (const w of raw as Array<Record<string, unknown>>) {
    if (typeof w?.id !== "number" || typeof w.width !== "number" || typeof w.height !== "number") continue;
    if (w.width < 100 || w.height < 60 || w.alpha === 0) continue;
    out.push({ id: w.id, name: typeof w.name === "string" ? w.name : "", width: w.width, height: w.height });
  }
  return out;
}

/**
 * Pick the window to capture from Live's windows (front to back): "live" is the main window (the
 * largest), "dialog" the frontmost window that is not the main one and is smaller than it.
 */
export function pickWindow(windows: LiveWindow[], target: "dialog" | "live"): LiveWindow | null {
  if (windows.length === 0) return null;
  const area = (w: LiveWindow) => w.width * w.height;
  const main = windows.reduce((best, w) => (area(w) > area(best) ? w : best));
  if (target === "live") return main;
  return windows.find((w) => w.id !== main.id && area(w) < area(main)) ?? null;
}

/** Width and height from a PNG's header, or null. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// ── the tools ───────────────────────────────────────────────────────────────────────────────

export interface DesktopOptions {
  run?: Runner;
  /** The project root (captures/ lives there). Default: two folders above this file. */
  root?: string;
  sleep?: (ms: number) => Promise<void>;
  readFile?: (file: string) => Uint8Array;
  mkdir?: (dir: string) => void;
}

export function createDesktop(options: DesktopOptions = {}) {
  const run = options.run ?? defaultRunner;
  const root = options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const readFile = options.readFile ?? ((file: string) => fs.readFileSync(file));
  const mkdir = options.mkdir ?? ((dir: string) => void fs.mkdirSync(dir, { recursive: true }));

  /** Bring Live to the front and make sure it is there; an Answer when it is not. */
  async function activateLive(): Promise<Answer | null> {
    const act = await run("osascript", ["-e", `tell application id "${LIVE_BUNDLE_ID}" to activate`]);
    if (act.code !== 0) return bad(`cannot bring Live to the front (is it running?): ${osaProblem(act.stderr)}`);
    for (let attempt = 0; attempt < 8; attempt++) {
      const front = await run("osascript", ["-e", 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true']);
      if (front.code !== 0) return bad(osaProblem(front.stderr));
      if (front.stdout.trim() === LIVE_BUNDLE_ID) return null;
      await sleep(150);
    }
    return bad("Live is not the frontmost app after activating it; nothing was typed.");
  }

  return {
    async keys(input: { text?: string; key?: string }): Promise<Answer> {
      const { text, key } = input;
      if (text === undefined && key === undefined) return bad("give text, a key, or both");
      if (text !== undefined && typableText(text) === null) return bad(`text must be 1..${MAX_TEXT} printable characters (use key for return, tab and escape)`);
      let spec: KeySpec | undefined;
      if (key !== undefined) {
        spec = KEYS[key];
        if (spec === undefined) return bad(`key "${key}" is not allowed; allowed: ${Object.keys(KEYS).join(", ")}`);
      }
      const front = await activateLive();
      if (front) return front;
      // The check and the keystrokes are one script: nothing is typed unless Live is in front and a cmdAbl dialog is its top window.
      const done = await run("osascript", ["-l", "JavaScript", "-e", guardedScript({ text, key: spec })]);
      if (done.code !== 0) return bad(osaProblem(done.stderr));
      let answer: { sent?: boolean; reason?: string } = {};
      try {
        answer = JSON.parse(done.stdout.trim());
      } catch {
        return bad("unexpected answer from the key script; nothing was confirmed sent");
      }
      if (answer.sent !== true) {
        return bad(
          answer.reason === "no-dialog"
            ? "no cmdAbl dialog is in front; nothing was typed (keys would reach the Set itself). Open one with cmdabl_show first."
            : "Live is not the frontmost app; nothing was typed.",
        );
      }
      return ok(`sent to Live's dialog: ${[text !== undefined ? `text (${text.length} characters)` : "", key ? `key ${key}` : ""].filter(Boolean).join(" and ")}`);
    },

    async capture(input: { name: string; target: "dialog" | "live" }): Promise<Answer> {
      const { name, target } = input;
      if (!NAME.test(name)) return bad("name must be 1..60 characters of a-z, 0-9 and - only");
      if (target !== "dialog" && target !== "live") return bad('target must be "dialog" or "live"');
      const listed = await run("osascript", ["-l", "JavaScript", "-e", WINDOW_LIST_SCRIPT]);
      if (listed.code !== 0) return bad(`cannot list Live's windows: ${osaProblem(listed.stderr)}`);
      const windows = parseWindowList(listed.stdout.trim());
      if (windows === null) return bad("cannot read the window list (unexpected output)");
      const window = pickWindow(windows, target);
      if (!window) {
        return bad(
          target === "dialog"
            ? "no cmdAbl dialog window is open on screen (nothing captured): open one first, e.g. with cmdabl_show"
            : "no Live window found on screen (nothing captured): is Live running and visible?",
        );
      }
      const dir = path.join(root, "captures");
      const file = path.join(dir, `${name}.png`);
      try {
        mkdir(dir);
      } catch {
        return bad("cannot create the captures folder");
      }
      const shot = await run("screencapture", ["-x", "-o", "-l", String(window.id), file]);
      if (shot.code !== 0) {
        return bad(`screencapture failed (is Screen Recording allowed for the terminal app? System Settings → Privacy & Security → Screen Recording): ${shot.stderr.trim().slice(0, 200)}`);
      }
      let size: { width: number; height: number } | null = null;
      try {
        size = pngSize(readFile(file));
      } catch {
        size = null;
      }
      if (!size) return bad("screencapture wrote no readable image (Screen Recording may be missing); nothing was kept");
      return ok(`captured ${target} window${window.name ? ` "${window.name}"` : ""}: captures/${name}.png (${size.width}×${size.height} px)`);
    },
  };
}

export type Desktop = ReturnType<typeof createDesktop>;
