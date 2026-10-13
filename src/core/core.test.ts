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
  assert.match(bad.result.message ?? "", /valid: setup, bridge/);
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
    "OK: installed\n\nRemote Script 0.1.0 is installed, but Live still runs 0.0.9. Restart Live to load Remote Script 0.1.0.",
  );
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
  assert.match(text, /^mute tracks\n\nToggles the mute state of every named track\.\n\nusage: mute <track>…/);
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
  assert.equal(usage(tree2[0]!, ["mute"]), "mute [--set <0|1>] <track>…");
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
