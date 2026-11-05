import { test } from "node:test";
import assert from "node:assert/strict";
import { actionAt, createSetupFlow, decideOpen, readSetupState, SETUP_STATE_FILE, type SetupFlowDeps, type SetupState } from "./setupFlow.js";
import { karabinerImportUrl, type SetupFacts } from "./setupRows.js";
import { parseNotifyAnswer } from "../surfaces/pickResult.js";
import { capSections } from "../surfaces/present.js";
import { ExitCode, ok, fail, type ResultSection } from "../types.js";
import type { NotifyAnswer, NotifyRequest } from "../surfaces/ui.js";

const down = { ok: false as const, code: 5 as const, text: "Remote Script not running" };
const goodFacts = (over: Partial<SetupFacts["script"]> = {}): SetupFacts => ({
  platform: "darwin",
  trigger: { installed: true, ruleThere: true, enabled: true },
  script: { shipped: "0.1.15", installed: { status: "current", version: "0.1.15" }, running: { ok: true, value: { script: "0.1.15", v: 1, ops: [] } }, copyNewerThanHost: false, copyFailed: null, ...over },
  dataFolderWritable: true,
  importUrl: karabinerImportUrl(27184),
  controlSurfaceUrl: "https://docs",
});
const missingFacts = (copyFailed: string | null): SetupFacts => goodFacts({ installed: { status: "missing" }, running: down, copyFailed });

function harness(over: { answers?: Array<NotifyAnswer | null>; facts?: (copyFailed: string | null) => SetupFacts; headless?: boolean; settings?: Record<string, unknown>; state?: SetupState } = {}) {
  const requests: NotifyRequest[] = [];
  const ran: string[] = [];
  const opened: string[] = [];
  const saved: Array<Record<string, unknown>> = [];
  const files = new Map<string, string>();
  if (over.state) files.set(SETUP_STATE_FILE, JSON.stringify(over.state));
  const answers = [...(over.answers ?? [])];
  const settings = { "setup.openOnStart": true, "setup.autoScript": false, ...over.settings };
  const deps: SetupFlowDeps = {
    notifyAnswer: async (r) => (requests.push(r), answers.shift() ?? null),
    headless: () => over.headless === true,
    facts: async (c) => (over.facts ?? (() => goodFacts()))(c),
    runCommand: async (line) => (ran.push(line), line === "cmdabl setup copy" ? ok("copied") : fail(ExitCode.FAILURE, "no")),
    openUrl: async (url) => (opened.push(url), ok()),
    settings: { get: async () => settings as never, set: async (p) => (saved.push(p), true) },
    files: { read: async (n) => files.get(n) ?? null, write: async (n, t) => (files.set(n, t), true) },
    version: "0.1.6",
    copyScript: () => ok("copied"),
  };
  return { flow: createSetupFlow(deps), requests, ran, opened, saved, files };
}

test("cmdabl setup shows the page with the toggle for setup.openOnStart; Close ends the flow and the page counts as seen", async () => {
  const h = harness({ answers: [null] });
  const r = await h.flow.show();
  assert.equal(r.code, ExitCode.OK);
  assert.equal(r.message, undefined);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0]!.toggle, { label: "Don't open this page by itself", setting: "setup.openOnStart", on: false });
  assert.deepEqual(JSON.parse(h.files.get(SETUP_STATE_FILE)!), { seenVersion: "0.1.6", shown: [] });
});

test("the checkbox is saved as the opposite of openOnStart, with or without an action", async () => {
  const h = harness({ answers: [{ toggle: true }] });
  await h.flow.show();
  assert.deepEqual(h.saved, [{ "setup.openOnStart": false }]);
  const g = harness({ settings: { "setup.openOnStart": false }, answers: [{ toggle: false }] });
  await g.flow.show();
  assert.equal(g.requests[0]!.toggle!.on, true); // off in the settings = checked on the page
  assert.deepEqual(g.saved, [{ "setup.openOnStart": true }]);
});

test("a command button runs its command, then the page comes again with the new state", async () => {
  let installed = false;
  const requests: NotifyRequest[] = [];
  const ran: string[] = [];
  const flow = createSetupFlow({
    notifyAnswer: async (r) => (requests.push(r), requests.length === 1 ? { action: [1, 0] } : null),
    headless: () => false,
    facts: async () => (installed ? goodFacts() : missingFacts(null)),
    runCommand: async (line) => (ran.push(line), (installed = true), ok()),
    openUrl: async () => ok(),
    settings: { get: async () => ({ "setup.openOnStart": true }) as never, set: async () => true },
    files: { read: async () => null, write: async () => true },
    version: "0.1.6",
    copyScript: () => ok(),
  });
  await flow.show();
  assert.deepEqual(ran, ["cmdabl setup copy"]);
  assert.equal(requests.length, 2);
  const states = (r: NotifyRequest) => r.sections!.flatMap((s) => s.items).map((i) => (typeof i === "object" ? i.status : "text"));
  assert.ok(states(requests[0]!).includes("warn"));
  assert.ok(states(requests[1]!).every((x) => x === "ok"));
});

test("a failed copy comes back as a red row with the reason", async () => {
  const requests: NotifyRequest[] = [];
  const flow = createSetupFlow({
    notifyAnswer: async (r) => (requests.push(r), requests.length === 1 ? { action: [1, 0] } : null),
    headless: () => false,
    facts: async (c) => missingFacts(c),
    runCommand: async () => fail(ExitCode.FAILURE, "permission denied"),
    openUrl: async () => ok(),
    settings: { get: async () => ({ "setup.openOnStart": true }) as never, set: async () => true },
    files: { read: async () => null, write: async () => true },
    version: "0.1.6",
    copyScript: () => ok(),
  });
  await flow.show();
  const text = JSON.stringify(requests.at(-1)!.sections);
  assert.match(text, /"status":"fail"/);
  assert.match(text, /permission denied/);
});

test("a url button opens its url, nothing else; an index without an action does nothing", async () => {
  const h = harness({ facts: () => ({ ...goodFacts(), trigger: { installed: true, ruleThere: false, enabled: null } }), answers: [{ action: [0, 0] }, { action: [2, 0] }] });
  await h.flow.show();
  assert.deepEqual(h.opened, [karabinerImportUrl(27184)]);
  assert.deepEqual(h.ran, []);
  assert.equal(h.requests.length, 2); // the second answer named a ✓ row without a button: the page closed, nothing ran
});

test("actionAt looks in the sent sections only; parseNotifyAnswer drops what the request does not offer", () => {
  const sections: ResultSection[] = [{ heading: "h", items: ["plain", { text: "a", status: "ok" }, { text: "b", status: "warn", action: { label: "Go", command: "cmdabl setup copy" } }] }];
  assert.equal(actionAt(sections, [0, 0]), undefined);
  assert.equal(actionAt(sections, [0, 1]), undefined);
  assert.deepEqual(actionAt(sections, [0, 2]), { label: "Go", command: "cmdabl setup copy" });
  assert.equal(actionAt(sections, [5, 0]), undefined);
  const request = { sections, toggle: { label: "x", setting: "s", on: false } };
  assert.deepEqual(parseNotifyAnswer('{"action":[0,2],"toggle":true}', request), { action: [0, 2], toggle: true });
  assert.deepEqual(parseNotifyAnswer('{"action":[0,1]}', request), null); // no action on that row
  assert.deepEqual(parseNotifyAnswer('{"action":[0,2],"command":"rm -rf /","url":"https://x"}', request), { action: [0, 2] });
  assert.deepEqual(parseNotifyAnswer('{"toggle":true}', { sections }), null); // no checkbox was offered
  assert.deepEqual(parseNotifyAnswer('{"open":true}', request), null); // no link was offered
  assert.equal(parseNotifyAnswer("", request), null);
  assert.equal(parseNotifyAnswer("not json", request), null);
  assert.equal(parseNotifyAnswer('{"action":["0",2]}', request), null);
});

test("capSections keeps status rows (text clipped, bad status and empty actions dropped) and strings", () => {
  const out = capSections([
    {
      heading: "h",
      items: [
        "plain",
        { text: "x".repeat(400), status: "nope" as never, action: { label: " ", command: "c" } },
        { text: "ok", status: "ok", action: { label: "Go", help: "h", url: "https://a" } },
        { text: 4 as never },
        null as never,
      ],
    },
  ]);
  const items = out[0]!.items as Array<string | { text: string; status?: string; action?: unknown }>;
  assert.equal(items.length, 3);
  assert.equal(items[0], "plain");
  assert.equal((items[1] as { text: string }).text.length, 300);
  assert.equal((items[1] as { status?: string }).status, undefined);
  assert.equal((items[1] as { action?: unknown }).action, undefined);
  assert.deepEqual(items[2], { text: "ok", status: "ok", action: { label: "Go", help: "h", url: "https://a" } });
});

test("opening rule: first start opens; a new yellow row opens; the same yellow row does not; openOnStart off never", () => {
  const row = (signature: string) => ({ id: "script", status: signature ? ("warn" as const) : ("ok" as const), signature });
  const first = decideOpen({ openOnStart: true, state: { seenVersion: null, shown: [] }, rows: [row("")], version: "0.1.6" });
  assert.equal(first.open, true);
  assert.deepEqual(first.next, { seenVersion: "0.1.6", shown: [] });
  const again = decideOpen({ openOnStart: true, state: first.next, rows: [row("")], version: "0.1.6" });
  assert.equal(again.open, false);
  const yellow = decideOpen({ openOnStart: true, state: first.next, rows: [row("script:warn:a>b")], version: "0.1.7" });
  assert.equal(yellow.open, true);
  assert.deepEqual(yellow.next, { seenVersion: "0.1.7", shown: ["script:warn:a>b"] });
  const same = decideOpen({ openOnStart: true, state: yellow.next, rows: [row("script:warn:a>b")], version: "0.1.7" });
  assert.equal(same.open, false);
  const newer = decideOpen({ openOnStart: true, state: yellow.next, rows: [row("script:warn:a>c")], version: "0.1.8" });
  assert.equal(newer.open, true);
  // a row that went green drops out of shown, so breaking again counts as new
  const fixed = decideOpen({ openOnStart: true, state: yellow.next, rows: [row("")], version: "0.1.7" });
  assert.deepEqual(fixed.next.shown, []);
  assert.equal(decideOpen({ openOnStart: true, state: fixed.next, rows: [row("script:warn:a>b")], version: "0.1.7" }).open, true);
  const off = decideOpen({ openOnStart: false, state: { seenVersion: null, shown: [] }, rows: [row("script:warn:x")], version: "0.1.6" });
  assert.equal(off.open, false);
});

test("openIfNeeded: opens on the first start and stores what it showed; then stays shut for the same rows; off stays shut; headless never", async () => {
  const h = harness({ facts: () => missingFacts(null), answers: [null] });
  assert.equal(await h.flow.openIfNeeded(), true);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(h.files.get(SETUP_STATE_FILE)!).shown, ["script:warn:missing:0.1.15"]);
  const state = await readSetupState({ read: async () => h.files.get(SETUP_STATE_FILE) ?? null });
  const again = harness({ facts: () => missingFacts(null), state });
  assert.equal(await again.flow.openIfNeeded(), false);
  assert.equal(again.requests.length, 0);
  const off = harness({ facts: () => missingFacts(null), settings: { "setup.openOnStart": false } });
  assert.equal(await off.flow.openIfNeeded(), false);
  const headless = harness({ facts: () => missingFacts(null), headless: true });
  assert.equal(await headless.flow.openIfNeeded(), false);
});

test("headless: the rows come back as lines, no page opens, the state is untouched", async () => {
  const h = harness({ facts: () => missingFacts(null), headless: true });
  const r = await h.flow.show();
  assert.equal(r.code, ExitCode.OK);
  assert.match(r.message ?? "", /! The Remote Script is not installed.*\[Copy: cmdabl setup copy\]/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.files.size, 0);
});

test("autoCopy: only with setup.autoScript, only for a missing or older script; a failure is logged, never thrown", async () => {
  const copies: string[] = [];
  const mk = (settings: Record<string, unknown>, facts: SetupFacts, fails = false) => {
    const logs: string[] = [];
    const flow = createSetupFlow({
      notifyAnswer: async () => null,
      headless: () => false,
      facts: async () => facts,
      runCommand: async () => ok(),
      openUrl: async () => ok(),
      settings: { get: async () => ({ "setup.openOnStart": true, "setup.autoScript": true, ...settings }) as never, set: async () => true },
      files: { read: async () => null, write: async () => true },
      version: "0.1.6",
      warn: (t) => logs.push(t),
      copyScript: () => (copies.push("copy"), fails ? fail(ExitCode.FAILURE, "boom") : ok()),
    });
    return { flow, logs };
  };
  await mk({ "setup.autoScript": false }, missingFacts(null)).flow.autoCopy();
  assert.equal(copies.length, 0);
  await mk({}, goodFacts()).flow.autoCopy();
  assert.equal(copies.length, 0);
  await mk({}, missingFacts(null)).flow.autoCopy();
  assert.equal(copies.length, 1);
  await mk({}, goodFacts({ installed: { status: "outdated", version: "0.1.14" } })).flow.autoCopy();
  assert.equal(copies.length, 2);
  const failing = mk({}, missingFacts(null), true);
  await failing.flow.autoCopy();
  assert.match(failing.logs.join("\n"), /boom/);
});
