import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS, createDesktop, frontIsDialog, guardedScript, typableText, parseWindowList, pickWindow, pngSize, type LiveWindow, type Runner } from "./desktop.js";

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
  assert.ok(script.indexOf("frontIsDialog(ws)") < script.indexOf("se.keystroke("));
  assert.ok(script.indexOf("frontIsDialog(ws)") < script.indexOf("se.keyCode("));
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
