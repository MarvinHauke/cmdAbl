import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS, createDesktop, ffmpegArgs, frontIsDialog, guardedScript, parseCrop, typableText, type Spawner, parseWindowList, pickWindow, pngSize, type LiveWindow, type Runner } from "./desktop.js";

type Call = { file: string; args: string[] };
function fake(answer: (call: Call, n: number) => { code?: number; stdout?: string; stderr?: string }) {
  const calls: Call[] = [];
  const run: Runner = async (file, args) => {
    calls.push({ file, args });
    const a = answer({ file, args }, calls.length);
    return { code: a.code ?? 0, stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
  };
  return { calls, run };
}
const isFrontmostCheck = (c: Call) => c.args.some((a) => a.includes("frontmost is true"));

const png = (w: number, h: number) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

test("keys: only the allow-list, text must be printable and short, something must be given", async () => {
  const f = fake(() => ({}));
  const d = createDesktop({ run: f.run, sleep: async () => {} });
  assert.equal((await d.keys({})).isError, true);
  assert.match((await d.keys({ key: "cmd+q" })).text, /not allowed/);
  assert.match((await d.keys({ text: "a\nb" })).text, /printable/);
  assert.match((await d.keys({ text: "" })).text, /printable/);
  assert.match((await d.keys({ text: "x".repeat(201) })).text, /printable/);
  assert.equal(f.calls.length, 0); // nothing reached the OS
  assert.deepEqual(Object.keys(KEYS).sort(), ["cmd+s", "cmd+z", "delete", "down", "escape", "left", "return", "right", "space", "tab", "up"]);
});

const isGuarded = (c: Call) => c.args[0] === "-l" && c.args[3]?.includes("frontIsDialog(ws)") === true;
const sentTo = (calls: Call[]) => calls.filter(isGuarded);

test("typableText: printable and short only", () => {
  assert.equal(typableText('say "hi" \\ there'), 'say "hi" \\ there');
  assert.equal(typableText("\u0007"), null);
  assert.equal(typableText(""), null);
});

test("keys: activates Live, then ONE guarded script checks and types", async () => {
  const f = fake((c) => (isFrontmostCheck(c) ? { stdout: "com.ableton.live\n" } : isGuarded(c) ? { stdout: '{"sent":true}' } : {}));
  const out = await createDesktop({ run: f.run, sleep: async () => {} }).keys({ text: "tag -l", key: "return" });
  assert.equal(out.isError, false);
  assert.deepEqual(f.calls[0]!.args, ["-e", 'tell application id "com.ableton.live" to activate']);
  const scripts = sentTo(f.calls);
  assert.equal(scripts.length, 1); // the check and the keystrokes are one process
  const script = scripts[0]!.args[3]!;
  assert.ok(script.includes('se.keystroke("tag -l");') && script.includes("se.keyCode(36);"));
  // the guards come before any keystroke
  assert.ok(script.indexOf("not-frontmost") < script.indexOf("se.keystroke("));
  assert.ok(script.indexOf("frontIsDialog(liveWindows())") < script.indexOf("se.keystroke("));
  assert.ok(script.indexOf("frontIsDialog(liveWindows())") < script.indexOf("se.keyCode("));
});

test("keys: a main window in front (no dialog) or another app in front means nothing is typed", async () => {
  for (const [reason, expected] of [["no-dialog", /no cmdAbl dialog is in front/], ["not-frontmost", /not the frontmost/]] as const) {
    const f = fake((c) => (isFrontmostCheck(c) ? { stdout: "com.ableton.live" } : isGuarded(c) ? { stdout: JSON.stringify({ sent: false, reason }) } : {}));
    const out = await createDesktop({ run: f.run, sleep: async () => {} }).keys({ key: "delete" });
    assert.equal(out.isError, true);
    assert.match(out.text, expected);
    assert.match(out.text, /nothing was typed/);
  }
});

test("keys: when Live never becomes frontmost the guarded script is not even run", async () => {
  const f = fake((c) => (isFrontmostCheck(c) ? { stdout: "com.apple.Terminal\n" } : {}));
  const out = await createDesktop({ run: f.run, sleep: async () => {} }).keys({ key: "escape" });
  assert.equal(out.isError, true);
  assert.match(out.text, /not the frontmost/);
  assert.equal(sentTo(f.calls).length, 0);
});

test("keys: a missing Accessibility permission says where to grant it; so does Automation", async () => {
  const noAccess = fake((c) => (isFrontmostCheck(c) ? { stdout: "com.ableton.live" } : isGuarded(c) ? { code: 1, stderr: "osascript is not allowed assistive access. (-1719)" } : {}));
  const a = await createDesktop({ run: noAccess.run, sleep: async () => {} }).keys({ key: "tab" });
  assert.match(a.text, /Privacy & Security → Accessibility/);
  const noAuto = fake((c) => (isFrontmostCheck(c) ? { code: 1, stderr: "Not authorized to send Apple events to System Events. (-1743)" } : {}));
  const b = await createDesktop({ run: noAuto.run, sleep: async () => {} }).keys({ key: "tab" });
  assert.match(b.text, /Automation/);
});

test("the dialog rule: the topmost Live window must not be the largest", () => {
  const win = (id: number, width: number, height: number) => ({ id, width, height });
  assert.equal(frontIsDialog([win(7, 500, 260), win(3, 1800, 1000)]), true); // dialog over the main window
  assert.equal(frontIsDialog([win(3, 1800, 1000), win(7, 500, 260)]), false); // the main window in front
  assert.equal(frontIsDialog([win(3, 1800, 1000)]), false);
  assert.equal(frontIsDialog([]), false);
  assert.equal(frontIsDialog([win(4, 1800, 1000), win(3, 1800, 1000)]), false); // equal size is not a dialog
});

test("the key script: modifier keys keep their modifier, and the whole script is quoted safely", () => {
  assert.ok(guardedScript({ key: KEYS["cmd+z"] }).includes('se.keystroke("z", { using: "command down" });'));
  const tricky = guardedScript({ text: 'a"); do shell script "x' });
  assert.ok(tricky.includes('se.keystroke("a\\"); do shell script \\"x");'));
});

const w = (id: number, width: number, height: number, name = ""): LiveWindow => ({ id, name, width, height });

test("pickWindow: live is the largest, dialog the frontmost smaller one, none when there is none", () => {
  const list = [w(7, 520, 280, "palette"), w(3, 1800, 1000, "main"), w(5, 300, 200)]; // front to back
  assert.equal(pickWindow(list, "live")?.id, 3);
  assert.equal(pickWindow(list, "dialog")?.id, 7);
  assert.equal(pickWindow([w(3, 1800, 1000)], "dialog"), null);
  assert.equal(pickWindow([], "live"), null);
  assert.equal(pickWindow([w(3, 1800, 1000), w(4, 1800, 1000)], "dialog"), null); // equal size is not a dialog
});

test("parseWindowList drops invisible and tiny windows and bad output", () => {
  const out = parseWindowList(JSON.stringify([{ id: 1, name: "a", width: 800, height: 600, alpha: 1 }, { id: 2, width: 20, height: 20, alpha: 1 }, { id: 3, width: 800, height: 600, alpha: 0 }, { name: "no id" }]));
  assert.deepEqual(out?.map((x) => x.id), [1]);
  assert.equal(parseWindowList("not json"), null);
  assert.equal(parseWindowList("{}"), null);
});

test("pngSize reads the header", () => {
  assert.deepEqual(pngSize(png(640, 480)), { width: 640, height: 480 });
  assert.equal(pngSize(new Uint8Array(30)), null);
});

test("capture: validates the name and target before touching the OS", async () => {
  const f = fake(() => ({}));
  const d = createDesktop({ run: f.run });
  for (const name of ["", "A", "a b", "../x", "a/b", "x.png", "a".repeat(61)]) assert.match((await d.capture({ name, target: "live" })).text, /name must be/, name);
  assert.match((await d.capture({ name: "ok", target: "screen" as never })).text, /target/);
  assert.equal(f.calls.length, 0);
});

test("capture: lists Live's windows, then screencaptures that one window id by argument list, and reports the size", async () => {
  const windows = JSON.stringify([{ id: 41, name: "", width: 500, height: 260, alpha: 1 }, { id: 9, name: "Set", width: 1700, height: 900, alpha: 1 }]);
  const f = fake((c) => (c.file === "osascript" ? { stdout: windows } : {}));
  const made: string[] = [];
  const d = createDesktop({ run: f.run, root: "/proj", mkdir: (dir) => void made.push(dir), readFile: () => png(1000, 520) });
  const out = await d.capture({ name: "palette-empty", target: "dialog" });
  assert.equal(out.isError, false);
  assert.match(out.text, /captures\/palette-empty\.png \(1000×520 px\)/);
  assert.deepEqual(made, ["/proj/captures"]);
  assert.equal(f.calls[0]!.args[0], "-l");
  assert.deepEqual(f.calls[1], { file: "screencapture", args: ["-x", "-o", "-l", "41", "/proj/captures/palette-empty.png"] });
  const main = await createDesktop({ run: f.run, root: "/proj", mkdir: () => {}, readFile: () => png(10, 10) }).capture({ name: "main", target: "live" });
  assert.equal(f.calls[3]!.args[3], "9");
  assert.equal(main.isError, false);
});

test("capture: no matching window captures nothing and says so", async () => {
  const f = fake(() => ({ stdout: JSON.stringify([{ id: 9, width: 1700, height: 900, alpha: 1 }]) }));
  const out = await createDesktop({ run: f.run, root: "/proj", mkdir: () => {} }).capture({ name: "x", target: "dialog" });
  assert.equal(out.isError, true);
  assert.match(out.text, /nothing captured/);
  assert.ok(!f.calls.some((c) => c.file === "screencapture"));
});

test("capture: a failing or empty screencapture is an error with the Screen Recording hint", async () => {
  const win = JSON.stringify([{ id: 9, width: 1700, height: 900, alpha: 1 }]);
  const failing = fake((c) => (c.file === "osascript" ? { stdout: win } : { code: 1, stderr: "could not create image" }));
  const a = await createDesktop({ run: failing.run, root: "/p", mkdir: () => {} }).capture({ name: "x", target: "live" });
  assert.match(a.text, /Screen Recording/);
  const empty = fake((c) => (c.file === "osascript" ? { stdout: win } : {}));
  const b = await createDesktop({ run: empty.run, root: "/p", mkdir: () => {}, readFile: () => new Uint8Array(0) }).capture({ name: "x", target: "live" });
  assert.equal(b.isError, true);
});

// ── recordings (plan 0016 §6) ───────────────────────────────────────────────────────────────

const mainWindow = JSON.stringify([{ id: 9, name: "Set", width: 1700, height: 900, x: 10, y: 25, alpha: 1 }]);
const liveFront = (c: Call) => (isFrontmostCheck(c) ? { stdout: "com.ableton.live\n" } : c.args[0] === "-l" ? { stdout: mainWindow } : {});

function recorder(over: { exit?: { code: number; stderr: string } } = {}) {
  const started: Array<{ file: string; args: string[] }> = [];
  let finish: (r: { code: number; stderr: string }) => void = () => {};
  const spawn: Spawner = (file, args) => {
    started.push({ file, args });
    return { exited: new Promise((resolve) => { finish = resolve; if (over.exit) resolve(over.exit); }) };
  };
  return { started, spawn, finish: (code = 0) => finish({ code, stderr: "" }) };
}

test("record: validates name and seconds before touching the OS", async () => {
  const f = fake(() => ({}));
  const d = createDesktop({ run: f.run, sleep: async () => {} });
  assert.match((await d.record({ name: "A b", seconds: 5 })).text, /name must be/);
  for (const seconds of [0, 31, 1.5, NaN]) assert.match((await d.record({ name: "ok", seconds })).text, /seconds must be/);
  assert.equal(f.calls.length, 0);
});

test("record: activates Live, records only its main window's area, answers at once; a second one is refused until it ends", async () => {
  const f = fake(liveFront);
  const r = recorder();
  const d = createDesktop({ run: f.run, sleep: async () => {}, root: "/proj", mkdir: () => {}, spawn: r.spawn, now: () => 0, fileSize: () => 2048 });
  const first = await d.record({ name: "tag-demo", seconds: 8 });
  assert.equal(first.isError, false);
  assert.match(first.text, /captures\/tag-demo\.mov/);
  assert.deepEqual(r.started, [{ file: "screencapture", args: ["-v", "-V", "8", "-R", "10,25,1700,900", "-x", "/proj/captures/tag-demo.mov"] }]);
  const second = await d.record({ name: "other", seconds: 3 });
  assert.equal(second.isError, true);
  assert.match(second.text, /busy: "tag-demo" is still recording/);
  assert.equal(r.started.length, 1);
  assert.match((await d.recordStatus({ name: "tag-demo" })).text, /^recording/);
  r.finish();
  await new Promise((x) => setTimeout(x, 5));
  assert.match((await d.recordStatus({ name: "tag-demo" })).text, /^done: captures\/tag-demo\.mov \(2 KB\)/);
  assert.equal((await d.record({ name: "other", seconds: 3 })).isError, false); // free again
});

test("record: a refused permission ends at once and says where to grant it; no Live window records nothing", async () => {
  const f = fake(liveFront);
  const failed = recorder({ exit: { code: 1, stderr: "could not create image from display" } });
  const d = createDesktop({ run: f.run, sleep: async () => {}, root: "/p", mkdir: () => {}, spawn: failed.spawn });
  const out = await d.record({ name: "x", seconds: 2 });
  assert.equal(out.isError, true);
  assert.match(out.text, /Privacy & Security → Screen Recording/);
  const none = fake((c) => (isFrontmostCheck(c) ? { stdout: "com.ableton.live" } : c.args[0] === "-l" ? { stdout: "[]" } : {}));
  const r2 = recorder();
  const out2 = await createDesktop({ run: none.run, sleep: async () => {}, root: "/p", mkdir: () => {}, spawn: r2.spawn }).record({ name: "x", seconds: 2 });
  assert.match(out2.text, /nothing recorded/);
  assert.equal(r2.started.length, 0);
});

test("record_status: unknown name is an error; an old file reports done", async () => {
  const d = createDesktop({ root: "/p", fileSize: (f) => (f.endsWith("old.mov") ? 5 * 1024 * 1024 : null) });
  assert.match((await d.recordStatus({ name: "nope" })).text, /no recording named/);
  assert.match((await d.recordStatus({ name: "old" })).text, /done: .*5\.0 MB/);
  assert.match((await d.recordStatus({ name: "../x" })).text, /name must be/);
});

test("parseCrop and ffmpegArgs", () => {
  assert.deepEqual(parseCrop("800:600:10:20"), { w: 800, h: 600, x: 10, y: 20 });
  for (const bad of ["800:600:10", "a:b:c:d", "800:600:-1:0", "0:600:0:0", "800:600:10:20:1", "800 600 1 2", "1;rm:2:3:4"]) assert.equal(parseCrop(bad), null, bad);
  const mp4 = ffmpegArgs({ from: "/c/a.mov", to: "/c/a.mp4", format: "mp4", width: 1280, crop: { w: 800, h: 600, x: 10, y: 20 } });
  assert.deepEqual(mp4.slice(0, 4), ["-y", "-i", "/c/a.mov", "-an"]);
  assert.ok(mp4.includes("libx264") && mp4.includes("yuv420p") && mp4.includes("+faststart") && mp4[mp4.indexOf("-crf") + 1] === "24");
  assert.equal(mp4[mp4.indexOf("-vf") + 1], "crop=800:600:10:20,scale=1280:-2,scale=trunc(iw/2)*2:trunc(ih/2)*2");
  assert.equal(mp4.at(-1), "/c/a.mp4");
  const gif = ffmpegArgs({ from: "/c/a.mov", to: "/c/a.gif", format: "gif" });
  assert.match(gif[gif.indexOf("-filter_complex") + 1]!, /^\[0:v\]fps=12,scale=960:-1:flags=lanczos,split\[a\]\[b\];\[a\]palettegen\[p\];\[b\]\[p\]paletteuse$/);
  assert.equal(gif.at(-1), "/c/a.gif");
});

test("convert: validates, finds ffmpeg (PATH then Homebrew), runs it by argument list, reports the size", async () => {
  const f = fake((c) => (c.file === "ffmpeg" ? { code: 1, stderr: "ENOENT" } : {}));
  const sizes: Record<string, number> = { "/p/captures/a.mov": 9000, "/p/captures/a.gif": 3 * 1024 * 1024 };
  const d = createDesktop({ run: f.run, root: "/p", fileSize: (file) => sizes[file] ?? null });
  assert.match((await d.convert({ name: "a", format: "avi" as never })).text, /format must be/);
  assert.match((await d.convert({ name: "a", format: "gif", width: 5000 })).text, /width must be/);
  assert.match((await d.convert({ name: "a", format: "gif", crop: "1:2:3" })).text, /crop must be/);
  assert.match((await d.convert({ name: "missing", format: "gif" })).text, /no recording named/);
  assert.equal(f.calls.length, 0);
  const out = await d.convert({ name: "a", format: "gif" });
  assert.equal(out.isError, false);
  assert.match(out.text, /captures\/a\.gif \(3\.0 MB\)/);
  assert.deepEqual(f.calls.map((c) => c.file), ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"]);
  assert.equal(f.calls[2]!.args.at(-1), "/p/captures/a.gif");
});

test("convert: no ffmpeg says so; a failing ffmpeg is an error; a recording still running is refused", async () => {
  const none = fake(() => ({ code: 1, stderr: "ENOENT" }));
  const d = createDesktop({ run: none.run, root: "/p", fileSize: () => 100 });
  assert.match((await d.convert({ name: "a", format: "mp4" })).text, /ffmpeg was not found.*brew install ffmpeg/);
  const broken = fake((c) => (c.args.includes("-version") ? {} : { code: 1, stderr: "line1\nInvalid data found" }));
  const d2 = createDesktop({ run: broken.run, root: "/p", fileSize: () => 100 });
  assert.match((await d2.convert({ name: "a", format: "mp4" })).text, /ffmpeg failed: .*Invalid data/);
  const busy = fake(liveFront);
  const r = recorder();
  const d3 = createDesktop({ run: busy.run, sleep: async () => {}, root: "/p", mkdir: () => {}, spawn: r.spawn, fileSize: () => 100 });
  await d3.record({ name: "live", seconds: 5 });
  assert.match((await d3.convert({ name: "live", format: "mp4" })).text, /still recording/);
});

test("keys: delayMs is validated, types one character at a time, checks the focus before each, and the timeout grows", async () => {
  const f = fake(() => ({}));
  const d = createDesktop({ run: f.run, sleep: async () => {} });
  for (const delayMs of [-1, 301, 1.5]) assert.match((await d.keys({ key: "escape", delayMs })).text, /delayMs must be/);
  assert.equal(f.calls.length, 0);
  const slow = guardedScript({ text: "abc", key: KEYS["return"], delayMs: 100 });
  assert.ok(slow.includes("Array.from(\"abc\")") && slow.includes("app.delay(0.1)"));
  assert.ok(slow.indexOf("if (why()) break;") < slow.indexOf("se.keystroke(chars[i])")); // both guards are checked per character
  assert.ok(slow.includes("if (out.sent) { if (why())")); // and again right before the key
  assert.ok(!guardedScript({ text: "abc" }).includes("app.delay"));
  const g = fake((c) => (isFrontmostCheck(c) ? { stdout: "com.ableton.live" } : isGuarded(c) ? { stdout: '{"sent":false,"reason":"moved-away","typed":2}' } : {}));
  const out = await createDesktop({ run: g.run, sleep: async () => {} }).keys({ text: "abcd", delayMs: 50 });
  assert.match(out.text, /lost the focus after 2 characters/);
});

// The generated script, run against a fake macOS: the guards are the real ones.
import * as vm from "node:vm";

function runKeyScript(script: string, world: { front: () => string; windows: () => Array<{ id: number; w: number; h: number }> }) {
  const events: string[] = [];
  const se = {
    processes: { whose: () => [{ bundleIdentifier: () => world.front() }] },
    keystroke: (text: string, o?: { using: string }) => void events.push(o ? `${o.using}:${text}` : `text:${text}`),
    keyCode: (code: number) => void events.push(`key:${code}`),
  };
  const sandbox = {
    ObjC: { import() {}, deepUnwrap: (x: unknown) => x, castRefToObject: (x: unknown) => x },
    $: { CGWindowListCopyWindowInfo: () => world.windows().map((w) => ({ kCGWindowOwnerName: "Live", kCGWindowNumber: w.id, kCGWindowAlpha: 1, kCGWindowBounds: { Width: w.w, Height: w.h } })), kCGWindowListOptionOnScreenOnly: 1, kCGWindowListExcludeDesktopElements: 2, kCGNullWindowID: 0 },
    Application: Object.assign(() => se, { currentApplication: () => ({ includeStandardAdditions: false, delay() { events.push("wait"); } }) }),
    JSON,
    Array,
  };
  const answer = JSON.parse(vm.runInNewContext(script, sandbox) as string) as { sent: boolean; reason?: string; typed?: number };
  return { answer, events: events.filter((e) => e !== "wait") };
}

const DIALOG_OVER_MAIN = [{ id: 7, w: 500, h: 260 }, { id: 3, w: 1800, h: 1000 }];
const MAIN_ONLY = [{ id: 3, w: 1800, h: 1000 }];

test("script run: a dialog in front types everything, then presses the key", () => {
  const out = runKeyScript(guardedScript({ text: "ab", key: KEYS["return"], delayMs: 50 }), { front: () => "com.ableton.live", windows: () => DIALOG_OVER_MAIN });
  assert.deepEqual(out.answer, { sent: true });
  assert.deepEqual(out.events, ["text:a", "text:b", "key:36"]);
});

test("script run: no dialog or another app in front at the start types nothing", () => {
  const main = runKeyScript(guardedScript({ key: KEYS["delete"] }), { front: () => "com.ableton.live", windows: () => MAIN_ONLY });
  assert.deepEqual(main.answer, { sent: false, reason: "no-dialog" });
  assert.deepEqual(main.events, []);
  const other = runKeyScript(guardedScript({ text: "x", delayMs: 10 }), { front: () => "com.apple.Terminal", windows: () => DIALOG_OVER_MAIN });
  assert.deepEqual(other.answer, { sent: false, reason: "not-frontmost" });
  assert.deepEqual(other.events, []);
});

test("script run: the dialog closing while typing stops the typing and the final key is NOT pressed", () => {
  let windowCalls = 0;
  // the first window list is the start check; the dialog is gone from the third check on (after 1 character)
  const windows = () => (++windowCalls <= 2 ? DIALOG_OVER_MAIN : MAIN_ONLY);
  const out = runKeyScript(guardedScript({ text: "abcd", key: KEYS["delete"], delayMs: 50 }), { front: () => "com.ableton.live", windows });
  assert.deepEqual(out.answer, { sent: false, reason: "moved-away", typed: 1 });
  assert.deepEqual(out.events, ["text:a"]);
});

test("script run: the dialog closing after the last character stops the final key too", () => {
  let windowCalls = 0;
  // start check + one per character (2) pass; the check right before the key finds the main window
  const windows = () => (++windowCalls <= 3 ? DIALOG_OVER_MAIN : MAIN_ONLY);
  const out = runKeyScript(guardedScript({ text: "ab", key: KEYS["cmd+s"], delayMs: 50 }), { front: () => "com.ableton.live", windows });
  assert.deepEqual(out.answer, { sent: false, reason: "moved-away", typed: 2 });
  assert.deepEqual(out.events, ["text:a", "text:b"]);
});

test("script run: focus moving to another app mid-typing also stops it", () => {
  let n = 0;
  const front = () => (++n <= 3 ? "com.ableton.live" : "com.apple.Terminal");
  const out = runKeyScript(guardedScript({ text: "abcd", key: KEYS["return"], delayMs: 50 }), { front, windows: () => DIALOG_OVER_MAIN });
  assert.equal(out.answer.sent, false);
  assert.ok(out.events.length < 4 && !out.events.includes("key:36"));
});
