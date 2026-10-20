import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, quoteIfNeeded } from "./tokenize.js";
import { validateTree, usage, helpText, serializeTree, type CommandNode } from "./commandTree.js";
import { parse } from "./parse.js";
import { presentResult } from "./present.js";
import { ExitCode, ok, fail } from "./types.js";

const values = (input: string) => {
  const r = tokenize(input);
  assert.ok(r.ok, input);
  return r.tokens.map((t) => t.value);
};

// ── tokenizer ───────────────────────────────────────────────────────────────

test("tokenize: splits on whitespace", () => {
  assert.deepEqual(values("  mute   /a  /b "), ["mute", "/a", "/b"]);
  assert.deepEqual(values(""), []);
});

test("tokenize: quotes group words and are marked", () => {
  const r = tokenize(`mute "/Opal Lead/Reverb" '/Drums/Kick 2' -d`);
  assert.ok(r.ok);
  assert.deepEqual(r.tokens.map((t) => t.value), ["mute", "/Opal Lead/Reverb", "/Drums/Kick 2", "-d"]);
  assert.deepEqual(r.tokens.map((t) => t.quoted), [false, true, true, false]);
});

test("tokenize: backslash escapes, adjacent quoted parts join", () => {
  assert.deepEqual(values(`a\\ b "c\\"d" e'f g'h`), ["a b", 'c"d', "ef gh"]);
});

test("tokenize: positions cover the raw text", () => {
  const r = tokenize(`go "a b"`);
  assert.ok(r.ok);
  assert.deepEqual([r.tokens[1]!.start, r.tokens[1]!.end], [3, 8]);
});

test("tokenize: unterminated quote is an error", () => {
  const r = tokenize(`mute "/a`);
  assert.equal(r.ok, false);
});

test("quoteIfNeeded round-trips through the tokenizer", () => {
  for (const s of ["Kick", "Opal Lead", 'say "hi"', "back\\slash", ""]) {
    assert.deepEqual(values(quoteIfNeeded(s)), [s]);
  }
});

// ── tree ────────────────────────────────────────────────────────────────────

const noop = () => {};
const tree: CommandNode[] = [
  {
    name: "pakabl",
    summary: "manage extensions",
    children: [
      {
        name: "install",
        summary: "install an extension",
        options: [
          { name: "force", short: "f", summary: "reinstall" },
          { name: "ref", takesValue: true, summary: "version" },
        ],
        args: [{ name: "id", kind: "enum", complete: "pakabl-ids" }],
        run: noop,
      },
      { name: "list", aliases: ["ls"], summary: "list extensions", run: noop },
    ],
  },
  {
    name: "mute",
    summary: "mute tracks",
    args: [{ name: "path", kind: "path", variadic: true, multiple: "all" }],
    run: noop,
  },
  {
    name: "note",
    summary: "optional argument",
    args: [{ name: "text", kind: "text", required: false }],
    run: noop,
  },
];

test("validateTree: the sample tree is valid", () => {
  assert.deepEqual(validateTree(tree), []);
});

test("validateTree: reports each rule violation", () => {
  const bad = (node: CommandNode) => validateTree([node]).join("\n");
  assert.match(bad({ name: "x", summary: "s", run: noop, children: [{ name: "y", summary: "s", run: noop }] }), /either children or run/);
  assert.match(bad({ name: "x", summary: "s" }), /needs run/);
  assert.match(bad({ name: "Bad Name", summary: "s", run: noop }), /invalid name/);
  assert.match(bad({ name: "x", summary: "s", run: noop, options: [{ name: "help", summary: "s" }] }), /reserved/);
  assert.match(
    bad({ name: "x", summary: "s", run: noop, args: [{ name: "a", kind: "text", required: false }, { name: "b", kind: "text" }] }),
    /follows an optional/,
  );
  assert.match(
    bad({ name: "x", summary: "s", run: noop, args: [{ name: "a", kind: "text", variadic: true }, { name: "b", kind: "text" }] }),
    /last argument may be variadic/,
  );
  assert.match(
    bad({ name: "rm", summary: "s", destructive: true, run: noop, args: [{ name: "p", kind: "path", multiple: "all" }] }),
    /destructive/,
  );
  assert.match(
    validateTree([
      { name: "a", summary: "s", run: noop },
      { name: "b", aliases: ["a"], summary: "s", run: noop },
    ]).join("\n"),
    /duplicate name or alias "a"/,
  );
});

test("usage / helpText / serializeTree", () => {
  const install = tree[0]!.children![0]!;
  assert.equal(usage(install, ["pakabl", "install"]), "pakabl install [--force] [--ref <value>] <id>");
  assert.equal(usage(tree[0]!, ["pakabl"]), "pakabl <command>");
  assert.match(helpText(tree[0]!, ["pakabl"]), /install\s+install an extension/);
  const serialized = serializeTree(tree);
  assert.equal(JSON.stringify(serialized).includes("run\""), false);
  assert.equal(serialized[0]!.runnable, false);
  assert.equal(serialized[0]!.children![0]!.runnable, true);
});

// ── parser ──────────────────────────────────────────────────────────────────

const run = (input: string) => {
  const r = parse(input, tree);
  assert.equal(r.kind, "run", `${input} → ${JSON.stringify(r)}`);
  return r.kind === "run" ? r.invocation : (undefined as never);
};
const errorCode = (input: string) => {
  const r = parse(input, tree);
  assert.equal(r.kind, "error", `${input} → ${JSON.stringify(r)}`);
  return r.kind === "error" ? r.result.code : -1;
};

test("parse: subcommand with argument and options", () => {
  assert.deepEqual(run("pakabl install snake"), { path: ["pakabl", "install"], options: {}, args: [["snake"]] });
  assert.deepEqual(run("pakabl install -f --ref=1.2 snake").options, { force: true, ref: "1.2" });
  assert.deepEqual(run("pakabl install snake --ref 1.2").options, { ref: "1.2" });
});

test("parse: alias resolves to the canonical path", () => {
  assert.deepEqual(run("pakabl ls").path, ["pakabl", "list"]);
});

test("parse: variadic, quoting and --", () => {
  assert.deepEqual(run(`mute /a "/Opal Lead" /c`).args, [["/a", "/Opal Lead", "/c"]]);
  assert.deepEqual(run("mute -- -weird").args, [["-weird"]]);
  assert.deepEqual(run(`mute "-quoted"`).args, [["-quoted"]]);
});

test("parse: option values, escaped dashes and quoteIfNeeded round-trip", () => {
  assert.deepEqual(run(`pakabl install --ref "a b" x`).options, { ref: "a b" });
  assert.deepEqual(run(`pakabl install -f x`).options, { force: true });
  assert.deepEqual(run("mute \\-1").args, [["-1"]]);
  // Values with quotes, backslashes or a leading dash survive quoteIfNeeded → parse.
  for (const value of ['a "b" c', "it's", "back\\slash", "-x", "--to"]) {
    assert.deepEqual(run(`mute ${quoteIfNeeded(value)}`).args, [[value]], value);
    assert.deepEqual(run(`pakabl install --ref=${quoteIfNeeded(value)} x`).options, { ref: value }, value);
  }
  // `--` ends option parsing, help included.
  assert.equal(parse("mute -- --help", tree).kind, "run");
});

test("parse: a lone dash is a word; unknown options hint at quoting", () => {
  assert.deepEqual(run("mute /Kick - Sub").args, [["/Kick", "-", "Sub"]]);
  const r = parse("mute -6dB", tree);
  assert.equal(r.kind, "error");
  if (r.kind === "error") {
    assert.equal(r.result.code, ExitCode.USAGE);
    assert.match(r.result.message ?? "", /unknown option "-6dB"[\s\S]*quote it or put -- before it/);
  }
});

test("parse: optional argument may be absent", () => {
  assert.deepEqual(run("note").args, [[]]);
  assert.deepEqual(run("note hi").args, [["hi"]]);
});

test("parse: error codes", () => {
  assert.equal(errorCode("nope"), ExitCode.NOT_FOUND);
  assert.equal(errorCode("pakabl frobnicate"), ExitCode.USAGE);
  assert.equal(errorCode("pakabl install"), ExitCode.USAGE); // missing <id>
  assert.equal(errorCode("pakabl install a b"), ExitCode.USAGE); // extra
  assert.equal(errorCode("pakabl install --nope a"), ExitCode.USAGE);
  assert.equal(errorCode("pakabl install a --ref"), ExitCode.USAGE); // value missing
  assert.equal(errorCode("pakabl install --force=1 a"), ExitCode.USAGE);
  assert.equal(errorCode("mute"), ExitCode.USAGE); // required variadic
  assert.equal(errorCode(`mute "/a`), ExitCode.USAGE); // unterminated quote
});

test("parse: help", () => {
  assert.deepEqual(parse("pakabl", tree), { kind: "help", node: tree[0], path: ["pakabl"] });
  const r = parse("pakabl install --help", tree);
  assert.equal(r.kind, "help");
  assert.equal(parse("", tree).kind, "help");
  assert.equal(parse("mute -h", tree).kind, "help");
});

// ── presenter ───────────────────────────────────────────────────────────────

test("presentResult: successes first, reasons indented, a parenthesis starts a line", () => {
  const shown: string[] = [];
  presentResult(fail(ExitCode.FAILURE, "arm: 2 of 4 done", [
    { path: "/Sub 37 Midi", ok: false, message: "Live did not arm it: its arm button is disabled (e.g. the input device is not available)" },
    { path: "/Sub37 Audio", ok: true },
    { path: "/Group", ok: false, message: "group tracks cannot be armed" },
    { path: "/Bass", ok: true },
    { path: "/Odd", ok: false },
  ]), (t) => shown.push(t));
  assert.deepEqual(shown, [
    [
      "cmdAbl: arm: 2 of 4 done",
      "  ✓ /Sub37 Audio",
      "  ✓ /Bass",
      "  × /Sub 37 Midi",
      "      Live did not arm it: its arm button is disabled",
      "      (e.g. the input device is not available)",
      "  × /Group",
      "      group tracks cannot be armed",
      "  × /Odd",
    ].join("\n"),
  ]);
});

test("presentResult: failures with the same reason list their targets and print the reason once", () => {
  const shown: string[] = [];
  const why = "Remote Script not running (install it with cmdabl setup, then restart Live)";
  presentResult(fail(ExitCode.UNAVAILABLE, "mute: 1 of 4 done", [
    { path: "/2-808 Core Kit/Snare Drum", ok: false, message: why },
    { path: "/Bass", ok: true },
    { path: "/Lead", ok: false, message: "not found" },
    { path: "/Kick", ok: false, message: why },
    { path: "/Odd", ok: false },
    { path: "/Odd2", ok: false },
  ]), (t) => shown.push(t));
  assert.deepEqual(shown, [
    [
      "cmdAbl: mute: 1 of 4 done",
      "  ✓ /Bass",
      "  × /2-808 Core Kit/Snare Drum",
      "  × /Kick",
      "      Remote Script not running",
      "      (install it with cmdabl setup, then restart Live)",
      "  × /Lead",
      "      not found",
      "  × /Odd",
      "  × /Odd2",
    ].join("\n"),
  ]);
});

test("presentResult: an all-success result lists no targets; a message without details is unchanged", () => {
  const shown: string[] = [];
  presentResult(ok("muted 2", [{ path: "/a", ok: true }, { path: "/b", ok: true }]), (t) => shown.push(t));
  presentResult(fail(ExitCode.NOT_FOUND, "nothing matches"), (t) => shown.push(t));
  assert.deepEqual(shown, ["muted 2", "cmdAbl: nothing matches"]);
});

test("presentResult: silent success, messages, failures with details", () => {
  const shown: string[] = [];
  const show = (t: string) => shown.push(t);
  presentResult(ok(), show);
  presentResult(ok("done"), show);
  presentResult(fail(ExitCode.FAILURE, "muted 1/2", [
    { path: "/a", ok: true },
    { path: "/b", ok: false, message: "not found" },
  ]), show);
  assert.deepEqual(shown, ["done", "cmdAbl: muted 1/2\n  ✓ /a\n  × /b\n      not found"]);
});

async function builtins(deps: Parameters<typeof import("./builtins.js").registerBuiltins>[1] = {}) {
  const { registerBuiltins } = await import("./builtins.js");
  const { CommandRegistry } = await import("./commandRegistry.js");
  const { runLine } = await import("./run.js");
  const registry = new CommandRegistry();
  registerBuiltins(registry, deps);
  const run = (line: string) => runLine(line, { registry, liveNodes: () => [], pick: async () => null, log: () => {} });
  return { registry, run };
}

test("cmdabl: a group on the tree — usage generated, unknown subcommand is a usage error naming the valid ones", async () => {
  const { run } = await builtins();
  for (const line of ["cmdabl", "cmdabl --help"]) {
    const out = await run(line);
    assert.equal(out.result.code, ExitCode.OK, line);
    assert.match(out.result.message ?? "", /usage: cmdabl <command>/);
    assert.match(out.result.message ?? "", /setup/);
    assert.match(out.result.message ?? "", /bridge/);
  }
  const bad = await run("cmdabl nope");
  assert.equal(bad.result.code, ExitCode.USAGE);
  assert.match(bad.result.message ?? "", /unknown subcommand "nope"/);
  assert.match(bad.result.message ?? "", /valid: setup, log, bridge/);
  // the old flags are gone
  assert.equal((await run("cmdabl --setup")).result.code, ExitCode.USAGE);
  assert.equal((await run("cmdabl --bridge")).result.code, ExitCode.USAGE);
});

test("help stays a command and lists cmdabl", async () => {
  const { run } = await builtins();
  const out = await run("help");
  assert.equal(out.result.code, ExitCode.OK);
  assert.match(out.result.message ?? "", /cmdabl\s+configure cmdAbl/);
});

test("cmdabl bridge: reports the bridge's answer", async () => {
  const { SCRIPT_VERSION } = await import("../ableton/bridgeProtocol.js");
  const good = await (await builtins({
    bridge: () => ({ ping: async () => ({ ok: true, value: { script: SCRIPT_VERSION, v: 1, ops: ["hello"] } }) }),
  })).run("cmdabl bridge");
  assert.equal(good.result.code, ExitCode.OK);
  assert.match(good.result.message ?? "", /^Remote Script \S+ is running \(protocol v1; \d+ ms; operations: hello\)$/);
  const down = await (await builtins({
    bridge: () => ({ ping: async () => ({ ok: false, code: 5, text: "Remote Script not running" }) }),
  })).run("cmdabl bridge");
  assert.equal(down.result.code, ExitCode.UNAVAILABLE);
  assert.equal(down.result.message, "Remote Script not running");
  assert.equal((await (await builtins()).run("cmdabl bridge")).result.code, ExitCode.UNAVAILABLE);
});

test("cmdabl setup: the installer's text, then what to do about the Remote Script", async () => {
  const { run } = await builtins({
    setup: () => "OK: installed",
    installed: () => ({ status: "current", version: "0.1.0" }),
    shippedVersion: "0.1.0",
    bridge: () => ({ ping: async () => ({ ok: true, value: { script: "0.0.9", v: 1, ops: [] } }) }),
  });
  const out = await run("cmdabl setup");
  assert.equal(out.result.code, ExitCode.OK);
  assert.equal(
    out.result.message,
    "OK: installed\n\nRemote Script 0.1.0 is installed, but Live still runs 0.0.9. Restart Live to load Remote Script 0.1.0.\n" +
      "https://marvinhauke.github.io/cmdAbl/getting-started/#3-turn-on-the-remote-script-in-live",
  );
});

test("setup docs links hang off one base URL", async () => {
  const { DOCS_BASE_URL, KEYBOARD_DOCS_URL, REMOTE_SCRIPT_DOCS_URL } = await import("./setup.js");
  assert.ok(KEYBOARD_DOCS_URL.startsWith(DOCS_BASE_URL) && REMOTE_SCRIPT_DOCS_URL.startsWith(DOCS_BASE_URL));
  assert.equal(KEYBOARD_DOCS_URL, "https://marvinhauke.github.io/cmdAbl/getting-started/#2-run-cmdabl-setup");
});

test("validateTree: requires must be a known companion on a runnable node", () => {
  const leaf = (extra: object): CommandNode<void, string> => ({ name: "x", summary: "s", run: () => {}, ...extra });
  assert.deepEqual(validateTree([leaf({ requires: ["bridge"] })]), []);
  assert.match(validateTree([leaf({ requires: ["nope"] })]).join("\n"), /unknown requirement "nope"/);
  const group: CommandNode<void, string> = { name: "g", summary: "s", requires: ["bridge"], children: [leaf({})] };
  assert.match(validateTree([group]).join("\n"), /requires belongs on the runnable node/);
});

// ── enum arguments ──────────────────────────────────────────────────────────

const manTree: CommandNode<void, string>[] = [
  { name: "man", summary: "manual", args: [{ name: "topic", kind: "enum", choices: ["ableton", "cmdabl"] }], run: () => {} },
];

test("enum: declared values pass (case-insensitive, declared spelling), others are a usage error naming the choices", () => {
  const good = parse("man CmdAbl", manTree);
  assert.equal(good.kind, "run");
  if (good.kind === "run") assert.deepEqual(good.invocation.args, [["cmdabl"]]);
  const bad = parse("man nope", manTree);
  assert.equal(bad.kind, "error");
  if (bad.kind === "error") {
    assert.equal(bad.result.code, ExitCode.USAGE);
    assert.match(bad.result.message ?? "", /invalid value "nope" for <topic>: choose one of ableton, cmdabl/);
  }
});

test("enum: usage and help show <a|b>; the serialized tree carries the choices; validation", () => {
  assert.equal(usage(manTree[0]!, ["man"]), "man <ableton|cmdabl>");
  assert.match(helpText(manTree[0]!, ["man"]), /usage: man <ableton\|cmdabl>/);
  const serialized = serializeTree(manTree);
  assert.deepEqual(serialized[0]!.args![0]!.choices, ["ableton", "cmdabl"]);
  assert.deepEqual(validateTree(manTree), []);
  const broken = (arg: object): CommandNode<void, string>[] => [{ name: "x", summary: "s", args: [{ name: "a", ...arg } as never], run: () => {} }];
  assert.match(validateTree(broken({ kind: "enum" })).join("\n"), /needs choices/);
  assert.deepEqual(validateTree(broken({ kind: "enum", complete: "pakabl-ids" })), []); // dynamic set: no parser check
  const dynamic = parse("x anything", broken({ kind: "enum", complete: "ids" }));
  assert.equal(dynamic.kind, "run");
  assert.match(validateTree(broken({ kind: "enum", choices: ["a", "a"] })).join("\n"), /duplicate choices/);
  assert.match(validateTree(broken({ kind: "enum", choices: ["Ab", "ab"] })).join("\n"), /duplicate choices/);
  assert.match(validateTree(broken({ kind: "enum", choices: ["-x"] })).join("\n"), /starts with a dash/);
  assert.match(validateTree(broken({ kind: "enum", choices: ["a"], rest: true })).join("\n"), /cannot take the rest/);
  assert.match(validateTree(broken({ kind: "text", choices: ["a"] })).join("\n"), /choices only applies to enum/);
});

// ── documentation fields ────────────────────────────────────────────────────

test("description, examples and argument summaries: validated, shown by help, carried by the tree", () => {
  const doc: CommandNode<void, string>[] = [
    {
      name: "mute",
      summary: "mute tracks",
      description: "Toggles the mute state of every named track.",
      args: [{ name: "track", kind: "path", variadic: true, summary: "the tracks to mute" }],
      examples: [{ line: "mute /Kick, /Snare", note: "mute both" }, { line: "mute vermona" }],
      run: () => {},
    },
  ];
  assert.deepEqual(validateTree(doc), []);
  const text = helpText(doc[0]!, ["mute"]);
  assert.match(text, /^mute tracks\n\nToggles the mute state of every named track\.\n\nusage: mute \[--pick\] <track>…/);
  assert.match(text, /arguments:\n  <track>\s+the tracks to mute/);
  assert.match(text, /examples:\n  mute \/Kick, \/Snare\n      mute both\n  mute vermona$/);
  const serialized = serializeTree(doc)[0]!;
  assert.equal(serialized.description, "Toggles the mute state of every named track.");
  assert.deepEqual(serialized.examples, doc[0]!.examples);
  assert.equal(serialized.args![0]!.summary, "the tracks to mute");

  const bad = (extra: object): string =>
    validateTree([{ name: "x", summary: "s", run: () => {}, ...extra } as CommandNode<void, string>]).join("\n");
  assert.match(bad({ description: " " }), /description must be a non-empty string/);
  assert.match(bad({ examples: [{ line: "" }] }), /an example needs a line/);
  assert.match(bad({ examples: [{ line: "x", note: "" }] }), /note of example/);
  assert.match(bad({ args: [{ name: "a", kind: "text", summary: "" }] }), /summary of argument "a"/);
  assert.match(
    validateTree([{ name: "g", summary: "s", examples: [{ line: "g x" }], children: [{ name: "c", summary: "s", run: () => {} }] }]).join("\n"),
    /examples belong on a runnable command/,
  );
});

test("option choices: the parser lists them on a bad value, usage shows <0|1>, the line is remembered with the option", () => {
  const tree2: CommandNode<void, string>[] = [
    {
      name: "mute",
      summary: "mute",
      options: [{ name: "set", short: "s", takesValue: true, choices: ["0", "1"], summary: "set the state" }],
      args: [{ name: "track", kind: "path", variadic: true }],
      run: () => {},
    },
  ];
  assert.deepEqual(validateTree(tree2), []);
  assert.equal(usage(tree2[0]!, ["mute"]), "mute [--set <0|1>] [--pick] <track>…");
  assert.match(helpText(tree2[0]!, ["mute"]), /-s, --set <0\|1>/);
  const good = parse("mute --set 0 /a", tree2);
  assert.equal(good.kind, "run");
  if (good.kind === "run") assert.deepEqual(good.invocation.options, { set: "0" });
  const short = parse("mute -s 1 /a", tree2);
  if (short.kind === "run") assert.deepEqual(short.invocation.options, { set: "1" });
  const bad = parse("mute --set 2 /a", tree2);
  assert.equal(bad.kind, "error");
  if (bad.kind === "error") {
    assert.equal(bad.result.code, ExitCode.USAGE);
    assert.match(bad.result.message ?? "", /invalid value "2" for option "--set": choose one of 0, 1/);
  }
  const broken = (opt: object): string =>
    validateTree([{ name: "x", summary: "s", options: [{ name: "o", summary: "s", ...opt }], run: () => {} } as CommandNode<void, string>]).join("\n");
  assert.match(broken({ choices: ["a"] }), /has choices but takes no value/);
  assert.match(broken({ takesValue: true, choices: ["a", "A"] }), /duplicate choices/);
  assert.match(broken({ takesValue: true, choices: ["-a"] }), /starts with a dash/);
  assert.match(broken({ takesValue: true, choices: [] }), /empty choices list/);
});

test("numeric option: whole numbers within a range, usage shows <n>, handler gets the text", () => {
  const tree3: CommandNode<void, string>[] = [
    { name: "tree", summary: "t", options: [{ name: "level", short: "L", takesValue: true, number: { min: 1, max: 12, integer: true }, summary: "depth" }], run: () => {} },
  ];
  assert.deepEqual(validateTree(tree3), []);
  assert.equal(usage(tree3[0]!, ["tree"]), "tree [--level <n>]");
  const ok = parse("tree -L 3", tree3);
  assert.equal(ok.kind, "run");
  if (ok.kind === "run") assert.deepEqual(ok.invocation.options, { level: "3" });
  for (const bad of ["0", "13", "2.5", "abc", "-1", "1e3", ""]) {
    const r = parse(`tree --level=${bad === "" ? '""' : bad}`, tree3);
    assert.equal(r.kind, "error", bad);
    if (r.kind === "error") assert.match(r.result.message ?? "", /for option "--level": a whole number from 1 to 12/);
  }
  const broken = (opt: object): string =>
    validateTree([{ name: "x", summary: "s", options: [{ name: "o", summary: "s", ...opt }], run: () => {} } as CommandNode<void, string>]).join("\n");
  assert.match(broken({ number: {} }), /numeric but takes no value/);
  assert.match(broken({ takesValue: true, number: { min: 5, max: 1 } }), /min above max/);
  assert.match(broken({ takesValue: true, number: {}, choices: ["1"] }), /both choices and number/);
});

test("helpForPath finds a command or subcommand by path", async () => {
  const { helpForPath } = await import("./commandTree.js");
  const roots = [{ name: "a", summary: "A", children: [{ name: "b", summary: "B", run: () => {} }] }] as any;
  assert.match(helpForPath(roots, ["a"])!, /^A/);
  assert.match(helpForPath(roots, ["a", "b"])!, /^B/);
  assert.equal(helpForPath(roots, ["x"]), undefined);
  assert.equal(helpForPath(roots, []), undefined);
});

test("presentResult: a link goes to the message only when it is a plain https URL with a label", () => {
  const seen: Array<{ text: string; link?: unknown }> = [];
  const show = (text: string, link?: unknown) => void seen.push({ text, link });
  const good = { label: "Open in browser", url: "https://example.com/a" };
  presentResult({ ...ok("man tag"), link: good }, show);
  presentResult({ ...ok("x"), link: { label: "Open", url: "javascript:alert(1)" } }, show);
  presentResult({ ...ok("y"), link: { label: " ", url: "https://example.com" } }, show);
  assert.deepEqual(seen[0]!.link, good);
  assert.equal(seen[1]!.link, undefined);
  assert.equal(seen[2]!.link, undefined);
});

test("wantsOpen: only {open:true} counts", async () => {
  const { wantsOpen } = await import("./pickResult.js");
  assert.equal(wantsOpen('{"open":true}'), true);
  for (const raw of [null, "", "{}", '{"open":"yes"}', "nope", "null"]) assert.equal(wantsOpen(raw), false, String(raw));
});

test("shortHelpText: usage, sections one line each, no prose, no examples, a pointer to man", async () => {
  const { shortHelpText, PICK_OPTION } = await import("./commandTree.js");
  const leaf: CommandNode<any, any> = {
    name: "mute",
    summary: "mute tracks",
    description: "A long paragraph that --help no longer prints.",
    examples: [{ line: "mute bass", note: "mute Bass" }],
    options: [{ name: "set", short: "s", takesValue: true, choices: ["0", "1"], summary: "set instead of toggle" }],
    args: [{ name: "target", kind: "path", kinds: ["track"], summary: "the track" }],
    run: () => {},
  } as never;
  assert.equal(
    shortHelpText(leaf, ["mute"], "man mute"),
    [
      "usage: mute [--set <0|1>] [--pick] <target>",
      "",
      "arguments:",
      "  <target>     the track",
      "",
      "options:",
      "  -s, --set <0|1>        set instead of toggle",
      `  --pick                 ${PICK_OPTION.summary}`,
      "",
      "more: man mute",
    ].join("\n"),
  );
});

test("shortHelpText: a group lists its subcommands; more points at the full path", async () => {
  const { shortHelpText } = await import("./commandTree.js");
  const group = {
    name: "history",
    summary: "past commands",
    description: "Long prose.",
    children: [{ name: "clear", summary: "forget everything", run: () => {} }, { name: "list", summary: "show them", run: () => {} }],
  } as never;
  assert.equal(
    shortHelpText(group, ["history"], "man history"),
    "usage: history <command>\n\ncommands:\n  clear        forget everything\n  list         show them\n\nmore: man history",
  );
  assert.match(shortHelpText((group as { children: never[] }).children[0]!, ["history", "clear"], "man history clear"), /more: man history clear$/);
});

test("shortHelpText: no 'more' line without a hint", async () => {
  const { shortHelpText } = await import("./commandTree.js");
  const node = { name: "x", summary: "s", run: () => {} } as never;
  assert.equal(shortHelpText(node, ["x"]), "usage: x");
});

test("presentResult: sections pass through capped; junk is dropped", async () => {
  const { capSections, MAX_ITEMS, MAX_TEXT } = await import("./present.js");
  const seen: unknown[] = [];
  presentResult(
    { ...ok("#fx: Lead"), sections: [{ heading: "#fx", meta: "1 track", items: ["/Lead"] }, { heading: "  ", items: ["x"] }] },
    (_t, _l, sections) => void seen.push(sections),
  );
  assert.deepEqual(seen[0], [{ heading: "#fx", meta: "1 track", items: ["/Lead"] }]);
  presentResult(ok("plain"), (_t, _l, sections) => void seen.push(sections));
  assert.equal(seen[1], undefined);
  const big = capSections([{ heading: "h", items: Array.from({ length: MAX_ITEMS + 5 }, () => "y".repeat(MAX_TEXT + 10)) }]);
  assert.equal(big[0]!.items.length, MAX_ITEMS + 1);
  assert.equal(big[0]!.items[0]!.length, MAX_TEXT);
  assert.equal(big[0]!.items.at(-1), "…");
  assert.deepEqual(capSections(undefined), []);
  assert.deepEqual(capSections([{ heading: "h", items: [1 as never, "a"] }]), [{ heading: "h", items: ["a"] }]);
});

test("sectionsText sizes the dialog from the sections", async () => {
  const { sectionsText } = await import("./notifySize.js");
  assert.equal(sectionsText([{ heading: "#fx", meta: "2 tracks", items: ["/A", "/B"] }, { heading: "#x", items: [] }]), "#fx  2 tracks\n  /A\n  /B\n\n#x");
});

test("presentResult: sections never hide failures", () => {
  const seen: unknown[] = [];
  const sections = [{ heading: "h", items: ["a"] }];
  presentResult({ ...fail(ExitCode.FAILURE, "mute: 0 of 1 done", [{ path: "/A", ok: false, message: "no" }]), sections }, (_t, _l, s) => void seen.push(s));
  presentResult({ ...ok("x", [{ path: "/A", ok: false, message: "no" }]), sections }, (_t, _l, s) => void seen.push(s));
  assert.deepEqual(seen, [undefined, undefined]);
});

test("usageForPath is what --help prints: short, 'more: man' only with a man command", async () => {
  const { usageForPath } = await import("./commandTree.js");
  const a = { name: "a", summary: "A", description: "prose", children: [{ name: "b", summary: "B", run: () => {} }] } as never;
  assert.equal(usageForPath([a], ["a"]), "usage: a <command>\n\ncommands:\n  b            B");
  const man = { name: "man", summary: "m", run: () => {} } as never;
  assert.match(usageForPath([a, man], ["a", "b"])!, /usage: a b\n\nmore: man a b$/);
  assert.equal(usageForPath([a], ["x"]), undefined);
});

test("cmdabl log: last 50 lines, -n, --undo, --debug", async () => {
  const { CommandRegistry } = await import("./commandRegistry.js");
  const { registerBuiltins } = await import("./builtins.js");
  const { runLine } = await import("./run.js");
  const { createLog } = await import("./log.js");
  const log = createLog(() => {});
  const l = log.logger("tag");
  for (let i = 0; i < 60; i++) l.info(i % 10 === 0 ? `undo: tag back ${i}` : `changed ${i}`);
  const registry = new CommandRegistry();
  registerBuiltins(registry, { log });
  const deps = { registry, liveNodes: () => [], pick: async () => null };
  const text = async (line: string) => String((await runLine(line, deps as never)).result.message);
  assert.equal((await text("cmdabl log")).split("\n").length, 50);
  assert.ok((await text("cmdabl log")).endsWith("changed 59"));
  assert.match((await text("cmdabl log -n 1")), /^\d\d:\d\d:\d\d \[tag\] info: changed 59$/);
  assert.equal((await text("cmdabl log -n 5")).split("\n").length, 5);
  const undo = (await text("cmdabl log --undo")).split("\n");
  assert.equal(undo.length, 6);
  assert.deepEqual(undo.slice(0, 2), ["tag back 0", "tag back 10"]);
  assert.equal(undo[5], "tag back 50");
  assert.ok(undo.every((x) => x.startsWith("tag back ")));
  log.logger("run").info("start: tag undo: not a command");
  assert.equal((await text("cmdabl log --undo")).split("\n").length, 6);
  assert.equal((await runLine("cmdabl log -n 0", deps as never)).result.code, ExitCode.USAGE);
  l.debug("hidden");
  assert.ok(!(await text("cmdabl log")).includes("hidden"));
  assert.match(await text("cmdabl log --debug"), /^debug lines are on for this session/);
  l.debug("shown");
  assert.ok((await text("cmdabl log")).includes("debug: shown"));
  const empty = createLog(() => {});
  const r2 = new CommandRegistry();
  registerBuiltins(r2, { log: empty });
  assert.equal(String((await runLine("cmdabl log", { ...deps, registry: r2 } as never)).result.message), "the log is empty");
  assert.equal(String((await runLine("cmdabl log --undo", { ...deps, registry: r2 } as never)).result.message), "no undo commands logged yet");
});

test("cmdabl log: times, and a date line where the day changes", async () => {
  const { createLog, clockText, dayText } = await import("./log.js");
  const { CommandRegistry } = await import("./commandRegistry.js");
  const { registerBuiltins } = await import("./builtins.js");
  const { runLine } = await import("./run.js");
  const day1 = new Date(2026, 9, 20, 23, 59, 58, 123).getTime();
  const day2 = new Date(2026, 9, 21, 0, 0, 1, 5).getTime();
  let t = day1;
  const sunk: Array<[string, number]> = [];
  const log = createLog((line, _l, time) => void sunk.push([line, time]), 500, () => t);
  log.logger("tag").info("one");
  t = day2;
  log.logger("tag").info("two");
  assert.equal(clockText(day1, true), "23:59:58.123");
  assert.equal(dayText(day2), "2026-10-21");
  assert.deepEqual(sunk.map((x) => x[0]), ["cmdAbl [tag] info: one", "cmdAbl [tag] info: two"]);
  assert.deepEqual(log.lines(), ["cmdAbl [tag] info: one", "cmdAbl [tag] info: two"]);
  const registry = new CommandRegistry();
  registerBuiltins(registry, { log });
  const deps = { registry, liveNodes: () => [], pick: async () => null };
  const out = String((await runLine("cmdabl log", deps as never)).result.message);
  assert.equal(out, "2026-10-20\n23:59:58 [tag] info: one\n2026-10-21\n00:00:01 [tag] info: two");
});

// ── options with several values ─────────────────────────────────────────────

const renameTree: CommandNode<void, string>[] = [
  {
    name: "tag",
    summary: "tags",
    args: [{ name: "target", kind: "path", required: false }],
    options: [{ name: "rename", takesValue: true, values: 2, valueLabels: ["old", "new"], summary: "rename a tag" }],
    run: () => {},
  },
];

test("option with values: 2 takes the next two tokens; # and - stay plain text", () => {
  const r = parse("tag --rename #fx effects", renameTree);
  assert.equal(r.kind, "run");
  if (r.kind === "run") {
    assert.deepEqual(r.invocation.values, { rename: ["#fx", "effects"] });
    assert.equal(r.invocation.options.rename, true);
    assert.deepEqual(r.invocation.args, [[]]);
  }
  const after = parse("tag --rename fx effects /bass", renameTree);
  if (after.kind === "run") assert.deepEqual(after.invocation.args, [["/bass"]]);
  const inline = parse("tag --rename=fx -x", renameTree);
  if (inline.kind === "run") assert.deepEqual(inline.invocation.values, { rename: ["fx", "-x"] });
  assert.equal(parse("tag", renameTree).kind, "run");
});

test("option with values: too few values is a usage error naming the labels; usage and help show them", () => {
  const bad = parse("tag --rename fx", renameTree);
  assert.equal(bad.kind, "error");
  if (bad.kind === "error") {
    assert.equal(bad.result.code, ExitCode.USAGE);
    assert.match(bad.result.message ?? "", /option "--rename" needs <old> <new>/);
  }
  assert.equal(parse("tag --rename", renameTree).kind, "error");
  assert.match(usage(renameTree[0]!, ["tag"]), /\[--rename <old> <new>\]/);
  assert.match(helpText(renameTree[0]!, ["tag"]), /--rename <old> <new>/);
});

test("option with values: validation", () => {
  assert.deepEqual(validateTree(renameTree), []);
  const opt = (o: object): CommandNode<void, string>[] => [{ name: "x", summary: "s", options: [{ name: "o", summary: "s", ...o } as never], run: () => {} }];
  assert.match(validateTree(opt({ takesValue: true, values: 0 })).join("\n"), /at least 1/);
  assert.match(validateTree(opt({ takesValue: true, values: 2, choices: ["a"] })).join("\n"), /values together with choices or number/);
  assert.match(validateTree(opt({ takesValue: true, values: 2, number: {} })).join("\n"), /values together with choices or number/);
  assert.match(validateTree(opt({ takesValue: false, values: 2 })).join("\n"), /takes no value/);
  assert.match(validateTree(opt({ takesValue: true, values: 2, valueLabels: ["a"] })).join("\n"), /valueLabels/);
  assert.match(validateTree(opt({ takesValue: true, valueLabels: ["a", "b"] })).join("\n"), /for one value/);
  assert.match(validateTree(opt({ takesValue: false, valueLabels: ["a"] })).join("\n"), /takes no value/);
  assert.deepEqual(validateTree(opt({ takesValue: true, valueLabels: ["tag|#"] })), []);
});

test("option with values: the remembered line keeps every value", async () => {
  const { CommandRegistry } = await import("./commandRegistry.js");
  const { runLine } = await import("./run.js");
  const registry = new CommandRegistry();
  let seen: string[] | undefined;
  registry.add({ ...renameTree[0]!, run: (inv: { values?: Record<string, string[]> }) => { seen = inv.values?.rename; return ok("renamed"); } } as never);
  const out = await runLine('tag --rename fx "new name"', { registry, liveNodes: () => [], pick: async () => null } as never);
  assert.deepEqual(seen, ["fx", "new name"]);
  assert.equal(out.line, 'tag --rename fx "new name"');
});

test("palette items carry the value options of a command for the ghost hint", async () => {
  const { CommandRegistry } = await import("./commandRegistry.js");
  const { createCommandProvider } = await import("./commandProvider.js");
  const registry = new CommandRegistry();
  registry.add({
    ...renameTree[0]!,
    options: [
      ...renameTree[0]!.options!,
      { name: "edit", short: "e", takesValue: true, valueLabels: ["tag|#"], summary: "edit" },
      { name: "all", summary: "a flag" },
    ],
  } as never);
  registry.add({ name: "plain", summary: "p", run: () => {} } as never);
  registry.add({ name: "grp", summary: "g", children: [{ name: "go", summary: "s", options: [{ name: "n", takesValue: true, number: {}, summary: "n" }], run: () => {} }] } as never);
  const items = await createCommandProvider(registry).getItems();
  assert.deepEqual(items.find((i) => i.id === "tag")!.valueOptions, [
    { path: [], name: "rename", labels: ["old", "new"] },
    { path: [], name: "edit", short: "e", labels: ["tag|#"] },
  ]);
  assert.equal(items.find((i) => i.id === "plain")!.valueOptions, undefined);
  assert.deepEqual(items.find((i) => i.id === "grp")!.valueOptions, [{ path: ["go"], name: "n", labels: ["n"] }]);
});

test("match.ts ValueOptionSpec and commandTree.ts ValueOptionHint stay the same shape", async () => {
  const { valueHint } = await import("./match.js");
  const hints: import("./commandTree.js").ValueOptionHint[] = [{ path: [], name: "rename", labels: ["old", "new"] }];
  assert.equal(valueHint(hints, "--rename "), "<old>"); // fails to compile when the shapes drift apart
});

test("option with valueDefault: no value (last token, or an option follows) uses the default", () => {
  const tree: CommandNode<void, string>[] = [
    {
      name: "tag",
      summary: "tags",
      args: [{ name: "target", kind: "path", required: false }],
      options: [
        { name: "edit", short: "e", takesValue: true, valueLabels: ["tag|#"], valueDefault: "#", summary: "edit tags" },
        { name: "list", summary: "list" },
      ],
      run: () => {},
    },
  ];
  const opt = (line: string) => {
    const r = parse(line, tree);
    return r.kind === "run" ? [r.invocation.options.edit, r.invocation.args[0]] : r.kind;
  };
  assert.deepEqual(opt("tag -e"), ["#", []]);
  assert.deepEqual(opt("tag --edit --list"), ["#", []]);
  assert.deepEqual(opt("tag -e fx"), ["fx", []]);
  assert.deepEqual(opt("tag --edit=fx"), ["fx", []]);
  assert.deepEqual(opt("tag --edit="), [""  , []]);
  assert.match(usage(tree[0]!, ["tag"]), /\[--edit \[<tag\|#>\]\]/);
  assert.match(helpText(tree[0]!, ["tag"]), /-e, --edit \[<tag\|#>\]\s+edit tags \(default #\)/);
  assert.deepEqual(validateTree(tree), []);
  const bad = (o: object): CommandNode<void, string>[] => [{ name: "x", summary: "s", options: [{ name: "o", summary: "s", ...o } as never], run: () => {} }];
  assert.match(validateTree(bad({ takesValue: false, valueDefault: "a" })).join("\n"), /takes no value/);
  assert.match(validateTree(bad({ takesValue: true, values: 2, valueDefault: "a" })).join("\n"), /several values/);
  assert.match(validateTree(bad({ takesValue: true, valueDefault: "" })).join("\n"), /empty valueDefault/);
  assert.match(validateTree(bad({ takesValue: true, choices: ["0", "1"], valueDefault: "2" })).join("\n"), /not one of its choices/);
  assert.deepEqual(validateTree(bad({ takesValue: true, choices: ["0", "1"], valueDefault: "1" })), []);
  assert.match(validateTree(bad({ takesValue: true, number: {}, valueDefault: "1" })).join("\n"), /negative number/);
});
