import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, quoteIfNeeded } from "./tokenize.js";
import { validateTree, usage, helpText, serializeTree, type CommandNode } from "./commandTree.js";
import { parse } from "./parse.js";
import { presentResult } from "./present.js";
import { ExitCode, ok, fail } from "../types.js";

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
        args: [{ name: "id", kind: "enum" }],
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

test("presentResult: silent success, messages, failures with details", () => {
  const shown: string[] = [];
  const show = (t: string) => shown.push(t);
  presentResult(ok(), show);
  presentResult(ok("done"), show);
  presentResult(fail(ExitCode.FAILURE, "muted 1/2", [
    { path: "/a", ok: true },
    { path: "/b", ok: false, message: "not found" },
  ]), show);
  assert.deepEqual(shown, ["done", "cmdAbl: muted 1/2\n  ✓ /a\n  ✗ /b — not found"]);
});

test("cmdablUsage: lists every registered flag and points to man and help", async () => {
  const { cmdablUsage } = await import("./builtins.js");
  const text = cmdablUsage();
  assert.match(text, /--setup/);
  assert.match(text, /--help/);
  assert.match(text, /man cmdabl/);
  assert.match(text, /all commands: help/);
});

test("cmdabl --bridge: reports the bridge's answer, the usage lists the flag", async () => {
  const { registerBuiltins, cmdablUsage } = await import("./builtins.js");
  const { CommandRegistry } = await import("../commandRegistry.js");
  const { SCRIPT_VERSION } = await import("../ableton/bridgeProtocol.js");
  assert.match(cmdablUsage(), /--bridge/);
  const run = async (answer: Parameters<typeof registerBuiltins>[1]) => {
    const registry = new CommandRegistry();
    registerBuiltins(registry, answer);
    return registry.run("cmdabl", ["--bridge"]);
  };
  const good = await run({ bridge: () => ({ ping: async () => ({ ok: true, value: { script: SCRIPT_VERSION, v: 1, ops: ["hello"] } }) }) });
  assert.equal(good.code, ExitCode.OK);
  assert.ok((good.message ?? "").startsWith(`Remote Script ${SCRIPT_VERSION} is running`));
  assert.match(good.message ?? "", /^Remote Script \S+ is running \(protocol v1; \d+ ms; operations: hello\)$/);
  const down = await run({ bridge: () => ({ ping: async () => ({ ok: false, code: 5, text: "Remote Script not running" }) }) });
  assert.equal(down.code, ExitCode.UNAVAILABLE);
  assert.equal(down.message, "Remote Script not running");
  assert.equal((await run({})).code, ExitCode.UNAVAILABLE);
});

test("validateTree: requires must be a known companion on a runnable node", () => {
  const leaf = (extra: object): CommandNode<void, string> => ({ name: "x", summary: "s", run: () => {}, ...extra });
  assert.deepEqual(validateTree([leaf({ requires: ["bridge"] })]), []);
  assert.match(validateTree([leaf({ requires: ["nope"] })]).join("\n"), /unknown requirement "nope"/);
  const group: CommandNode<void, string> = { name: "g", summary: "s", requires: ["bridge"], children: [leaf({})] };
  assert.match(validateTree([group]).join("\n"), /requires belongs on the runnable node/);
});
