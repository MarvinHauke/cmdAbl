import { execFile, spawn } from "node:child_process";
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
export const MAX_DELAY_MS = 300;
const NAME = /^[a-z0-9-]{1,60}$/;

/** The one thing the OS layer needs: run a program with arguments and get its output. */
export type Runner = (file: string, args: string[], options?: { timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;

export const defaultRunner: Runner = (file, args, options) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: options?.timeoutMs ?? 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) + (error && !stderr ? error.message : "") });
    });
  });

/** A program started in the background (a recording): resolves when it ends. */
export type Spawner = (file: string, args: string[]) => { exited: Promise<{ code: number; stderr: string }> };

export const defaultSpawner: Spawner = (file, args) => {
  const exited = new Promise<{ code: number; stderr: string }>((resolve) => {
    let stderr = "";
    try {
      const child = spawn(file, args, { stdio: ["ignore", "ignore", "pipe"] });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < 2000) stderr += chunk.toString("utf8");
      });
      child.on("error", (e) => resolve({ code: 1, stderr: e.message }));
      child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    } catch (e: unknown) {
      resolve({ code: 1, stderr: e instanceof Error ? e.message : String(e) });
    }
  });
  return { exited };
};

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
export function guardedScript(input: {
  text?: string;
  key?: KeySpec;
  delayMs?: number;
  /** Tests only: a stand-in for System Events (so nothing real can be typed) and guards that always pass. */
  stub?: { systemEvents: string };
}): string {
  const actions: string[] = [];
  const delay = input.delayMs && input.delayMs > 0 ? Math.min(MAX_DELAY_MS, Math.floor(input.delayMs)) : 0;
  if (input.text !== undefined && delay === 0) actions.push(`se.keystroke(${JSON.stringify(input.text)}); typed = Array.from(${JSON.stringify(input.text)}).length;`);
  if (input.text !== undefined && delay > 0) {
    // The pause is the GLOBAL delay(): app.delay() on currentApplication() is "Message not understood" (-1708) in osascript.
    // One character at a time, so a typing recording is readable. Before EACH character both guards are checked
    // again (Live in front, a cmdAbl dialog on top): the dialog may close while the text is being typed.
    actions.push(`var chars = Array.from(${JSON.stringify(input.text)});
    var typed = 0;
    for (var i = 0; i < chars.length; i++) {
      if (why()) break;
      se.keystroke(chars[i]);
      typed++;
      delay(${delay / 1000});
    }
    if (typed < chars.length) { out = { sent: false, reason: 'moved-away', typed: typed }; }`);
  }
  if (input.key) {
    const press = "code" in input.key ? `se.keyCode(${input.key.code});` : `se.keystroke(${JSON.stringify(input.key.char)}, { using: ${JSON.stringify(input.key.using)} });`;
    // Not after text that stopped early, and only if both guards still hold right before the key.
    actions.push(`if (out.sent) { if (why()) { out = { sent: false, reason: 'moved-away', typed: ${input.text !== undefined ? "typed" : 0} }; } else { ${press} } }`);
  }
  const typedInit = input.text !== undefined && delay > 0 ? "" : "var typed = 0;";
  return `
ObjC.import('CoreGraphics');
${FRONT_IS_DIALOG_SRC}
var se = ${input.stub ? input.stub.systemEvents : "Application('System Events')"};
function liveWindows() {
  var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID)));
  return all.filter(function (w) { return w.kCGWindowOwnerName === ${JSON.stringify(LIVE_PROCESS)} && w.kCGWindowBounds.Width >= 100 && w.kCGWindowBounds.Height >= 60 && w.kCGWindowAlpha !== 0; })
    .map(function (w) { return { id: w.kCGWindowNumber, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height }; });
}
// Why keys must not be sent now, or null: Live must be the frontmost app AND a cmdAbl dialog its top window.
function why() {
  ${input.stub ? "return null; // stubbed" : ""}
  if (se.processes.whose({ frontmost: true })[0].bundleIdentifier() !== ${JSON.stringify(LIVE_BUNDLE_ID)}) return 'not-frontmost';
  if (!frontIsDialog(liveWindows())) return 'no-dialog';
  return null;
}
${typedInit}
var out = { sent: true };
var first = why();
if (first) {
  out = { sent: false, reason: first };
} else {
  ${actions.join("\n  ")}
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
  /** Top-left corner on screen, when the list gave it (a recording needs it). */
  x?: number;
  y?: number;
}

/** The JXA program that lists Live's on-screen windows, front to back, as JSON. */
export const WINDOW_LIST_SCRIPT = `
ObjC.import('CoreGraphics');
var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID)));
JSON.stringify(all.filter(function (w) { return w.kCGWindowOwnerName === ${JSON.stringify(LIVE_PROCESS)}; }).map(function (w) {
  return { id: w.kCGWindowNumber, name: w.kCGWindowName || '', width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height, x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, alpha: w.kCGWindowAlpha };
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
    out.push({
      id: w.id,
      name: typeof w.name === "string" ? w.name : "",
      width: w.width,
      height: w.height,
      ...(typeof w.x === "number" && typeof w.y === "number" ? { x: w.x, y: w.y } : {}),
    });
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
  /** Starts a recording in the background (default: child_process.spawn). */
  spawn?: Spawner;
  /** Size in bytes of a file, or null when it does not exist. */
  fileSize?: (file: string) => number | null;
  now?: () => number;
}

export const MAX_RECORD_SECONDS = 30;
const FFMPEG_CANDIDATES = ["ffmpeg", "/opt/homebrew/bin/ffmpeg"];
const SCREEN_RECORDING =
  "Is Screen Recording allowed for the terminal app? System Settings → Privacy & Security → Screen Recording (turn the terminal app on, then restart it).";

/** "w:h:x:y" in source pixels: four whole numbers, width and height at least 1. */
export function parseCrop(crop: string): { w: number; h: number; x: number; y: number } | null {
  const m = /^(\d{1,5}):(\d{1,5}):(\d{1,5}):(\d{1,5})$/.exec(crop);
  if (!m) return null;
  const [w, h, x, y] = m.slice(1).map(Number) as [number, number, number, number];
  return w >= 1 && h >= 1 ? { w, h, x, y } : null;
}

/** The ffmpeg arguments for a conversion (an argument list: no shell is involved). */
export function ffmpegArgs(input: { from: string; to: string; format: "mp4" | "gif"; width?: number; crop?: { w: number; h: number; x: number; y: number } }): string[] {
  const crop = input.crop ? `crop=${input.crop.w}:${input.crop.h}:${input.crop.x}:${input.crop.y}` : undefined;
  if (input.format === "mp4") {
    const filters = [crop, input.width ? `scale=${input.width}:-2` : undefined, "scale=trunc(iw/2)*2:trunc(ih/2)*2"].filter(Boolean).join(",");
    return ["-y", "-i", input.from, "-an", "-vf", filters, "-c:v", "libx264", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", input.to];
  }
  const pre = [crop, "fps=12", `scale=${input.width ?? 960}:-1:flags=lanczos`].filter(Boolean).join(",");
  return ["-y", "-i", input.from, "-filter_complex", `[0:v]${pre},split[a][b];[a]palettegen[p];[b][p]paletteuse`, "-loop", "0", input.to];
}

export function createDesktop(options: DesktopOptions = {}) {
  const run = options.run ?? defaultRunner;
  const root = options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const readFile = options.readFile ?? ((file: string) => fs.readFileSync(file));
  const mkdir = options.mkdir ?? ((dir: string) => void fs.mkdirSync(dir, { recursive: true }));
  const spawnJob = options.spawn ?? defaultSpawner;
  const now = options.now ?? (() => Date.now());
  const fileSize =
    options.fileSize ??
    ((file: string) => {
      try {
        return fs.statSync(file).size;
      } catch {
        return null;
      }
    });
  const size = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  /** The one recording of this server: a second one is refused while it runs. */
  let recording: { name: string; endsAt: number; file: string; result: { code: number; stderr: string } | null } | null = null;
  let ffmpegPath: string | null = null;

  const clock = (ms: number): string => {
    const d = new Date(ms);
    const two = (n: number): string => String(n).padStart(2, "0");
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  };

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
    async keys(input: { text?: string; key?: string; delayMs?: number }): Promise<Answer> {
      const { text, key } = input;
      const delayMs = input.delayMs ?? 0;
      if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) return bad(`delayMs must be a whole number from 0 to ${MAX_DELAY_MS}`);
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
      const typingMs = text !== undefined ? [...text].length * delayMs : 0;
      const done = await run("osascript", ["-l", "JavaScript", "-e", guardedScript({ text, key: spec, delayMs })], { timeoutMs: 15_000 + typingMs });
      if (done.code !== 0) return bad(osaProblem(done.stderr));
      let answer: { sent?: boolean; reason?: string; typed?: number } = {};
      try {
        answer = JSON.parse(done.stdout.trim());
      } catch {
        return bad("unexpected answer from the key script; nothing was confirmed sent");
      }
      if (answer.sent !== true) {
        if (answer.reason === "moved-away") return bad(`Live lost the focus after ${answer.typed ?? 0} characters; the rest was not typed.`);
        return bad(
          answer.reason === "no-dialog"
            ? "no cmdAbl dialog is in front; nothing was typed (keys would reach the Set itself). Open one with cmdabl_show first."
            : "Live is not the frontmost app; nothing was typed.",
        );
      }
      return ok(`sent to Live's dialog: ${[text !== undefined ? `text (${text.length} characters)` : "", key ? `key ${key}` : ""].filter(Boolean).join(" and ")}`);
    },

    async record(input: { name: string; seconds: number }): Promise<Answer> {
      const { name, seconds } = input;
      if (!NAME.test(name)) return bad("name must be 1..60 characters of a-z, 0-9 and - only");
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_RECORD_SECONDS) return bad(`seconds must be a whole number from 1 to ${MAX_RECORD_SECONDS}`);
      if (recording && recording.result === null) return bad(`busy: "${recording.name}" is still recording (until about ${clock(recording.endsAt)}); wait for it or check cmdabl_record_status`);
      const front = await activateLive();
      if (front) return bad(front.text.replace("nothing was typed.", "nothing was recorded."));
      const listed = await run("osascript", ["-l", "JavaScript", "-e", WINDOW_LIST_SCRIPT]);
      if (listed.code !== 0) return bad(`cannot list Live's windows: ${osaProblem(listed.stderr)}`);
      const windows = parseWindowList(listed.stdout.trim());
      const main = windows ? pickWindow(windows, "live") : null;
      if (!main || main.x === undefined || main.y === undefined) return bad("no Live window found on screen (nothing recorded): is Live running and visible?");
      const dir = path.join(root, "captures");
      const file = path.join(dir, `${name}.mov`);
      try {
        mkdir(dir);
      } catch {
        return bad("cannot create the captures folder");
      }
      const area = `${Math.round(main.x)},${Math.round(main.y)},${Math.round(main.width)},${Math.round(main.height)}`;
      const job = spawnJob("screencapture", ["-v", "-V", String(seconds), "-R", area, "-x", file]);
      const state = { name, endsAt: now() + seconds * 1000, file, result: null as { code: number; stderr: string } | null };
      recording = state;
      void job.exited.then((result) => {
        state.result = result;
      });
      // A refused permission ends the process at once: say so now instead of reporting a recording that never was.
      await Promise.race([job.exited, sleep(500)]);
      if (state.result && state.result.code !== 0) return bad(`screencapture could not record: ${state.result.stderr.trim().slice(0, 200)} ${SCREEN_RECORDING}`);
      return ok(`recording Live's window (${Math.round(main.width)}×${Math.round(main.height)} points) for ${seconds} s: captures/${name}.mov, ends about ${clock(state.endsAt)}. Do the actions now (cmdabl_show, cmdabl_keys); check with cmdabl_record_status.`);
    },

    async recordStatus(input: { name: string }): Promise<Answer> {
      const { name } = input;
      if (!NAME.test(name)) return bad("name must be 1..60 characters of a-z, 0-9 and - only");
      const file = path.join(root, "captures", `${name}.mov`);
      const bytes = fileSize(file);
      if (recording && recording.name === name) {
        if (recording.result === null) return ok(`recording, ends about ${clock(recording.endsAt)}${bytes !== null ? ` (${size(bytes)} so far)` : ""}`);
        if (recording.result.code !== 0) return bad(`recording failed: ${recording.result.stderr.trim().slice(0, 200)} ${SCREEN_RECORDING}`);
      }
      if (bytes === null) return bad(`no recording named "${name}" (captures/${name}.mov does not exist)`);
      return ok(`done: captures/${name}.mov (${size(bytes)})`);
    },

    async convert(input: { name: string; format: "mp4" | "gif"; width?: number; crop?: string }): Promise<Answer> {
      const { name, format, width, crop } = input;
      if (!NAME.test(name)) return bad("name must be 1..60 characters of a-z, 0-9 and - only");
      if (format !== "mp4" && format !== "gif") return bad('format must be "mp4" or "gif"');
      if (width !== undefined && (!Number.isInteger(width) || width < 100 || width > 4000)) return bad("width must be a whole number from 100 to 4000");
      let box: ReturnType<typeof parseCrop> | undefined;
      if (crop !== undefined) {
        box = parseCrop(crop);
        if (!box) return bad('crop must be "w:h:x:y", four whole numbers in source pixels (width and height at least 1)');
      }
      if (recording && recording.name === name && recording.result === null) return bad(`"${name}" is still recording; convert it when it is done`);
      const from = path.join(root, "captures", `${name}.mov`);
      if (fileSize(from) === null) return bad(`no recording named "${name}" (captures/${name}.mov does not exist)`);
      if (ffmpegPath === null) {
        for (const candidate of FFMPEG_CANDIDATES) {
          const probe = await run(candidate, ["-version"]);
          if (probe.code === 0) {
            ffmpegPath = candidate;
            break;
          }
        }
        if (ffmpegPath === null) return bad("ffmpeg was not found (not on PATH, not at /opt/homebrew/bin/ffmpeg): install it with brew install ffmpeg");
      }
      const to = path.join(root, "captures", `${name}.${format}`);
      const done = await run(ffmpegPath, ffmpegArgs({ from, to, format, width, crop: box ?? undefined }), { timeoutMs: 180_000 });
      if (done.code !== 0) return bad(`ffmpeg failed: ${done.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
      const bytes = fileSize(to);
      if (bytes === null || bytes === 0) return bad("ffmpeg wrote no file");
      return ok(`converted: captures/${name}.${format} (${size(bytes)})`);
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
