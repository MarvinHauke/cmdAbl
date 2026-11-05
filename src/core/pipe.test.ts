import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry } from "./commandRegistry.js";
import { parse } from "./parse.js";
import { runLine, type RunDeps } from "./run.js";
import { chainSegments, pipeAt, splitChain, splitPipe } from "./tokenize.js";
import { usage, validateTree, type CommandNode } from "./commandTree.js";
import { complete, type CompletionData } from "./complete.js";
import { completionTree } from "./commandTree.js";
import { ExitCode } from "./types.js";

const run = () => undefined;
const mapNode: CommandNode<any, any> = {
  name: "map",
  summary: "bind a control",
  options: [{ name: "learn", summary: "learn it" }],
  args: [
    { name: "control", kind: "text", required: false },
    { name: "operator", kind: "enum", choices: ["press", "release", "hold", "toggle"], required: false },
    { name: "line", kind: "text", raw: true },
  ],
  run,
};
const other: CommandNode<any, any> = { name: "note", summary: "a note", args: [{ name: "text", kind: "text", rest: true }], run };
const mute: CommandNode<any, any> = { name: "mute", summary: "mute", args: [{ name: "t", kind: "text", variadic: true }], run };

test("pipeAt / splitPipe: the first `|` outside quotes and escapes; quoted or escaped bars stay text", () => {
  assert.equal(pipeAt("map CC37 | mute"), 9);
  assert.equal(pipeAt('map "a|b" | x'), 10);
  assert.equal(pipeAt("map a\\|b"), -1);
  assert.equal(pipeAt("map 'a|b'"), -1);
  assert.equal(pipeAt("map CC37"), -1);
  assert.deepEqual(splitPipe("map CC37 hold |  mute #a; solo #b "), { head: "map CC37 hold ", raw: "mute #a; solo #b" });
  assert.deepEqual(splitPipe("map CC37|mute"), { head: "map CC37", raw: "mute" });
  assert.equal(splitPipe("map CC37"), null);
});

test("a `;` after the first `|` belongs to the binding; a `;` before it still splits", () => {
  assert.deepEqual(splitChain("map CC37 | mute #a; solo #b").map((p) => p.text), ["map CC37 | mute #a; solo #b"]);
  assert.deepEqual(splitChain("note hi; map CC37 | mute #a; solo #b").map((p) => p.text), ["note hi", "map CC37 | mute #a; solo #b"]);
  assert.deepEqual(splitChain('note "a|b"; mute x').map((p) => p.text), ['note "a|b"', "mute x"]); // a quoted bar does not stop the splitting
  assert.deepEqual(chainSegments("a | b; c"), [{ start: 0, end: 8 }]);
});

test("parse: the words before `|` are the arguments, the text after it is the raw argument, `;` and quotes untouched", () => {
  const roots = [mapNode, other];
  const out = parse("map CC37/ch2 toggle | solo #lead --set {}; mute \"a b\" ", roots);
  assert.equal(out.kind, "run");
  if (out.kind !== "run") return;
  assert.deepEqual(out.invocation.args, [["CC37/ch2"], ["toggle"], ['solo #lead --set {}; mute "a b"']]);
  assert.deepEqual(out.quoted[2], [false]);
  const bare = parse("map CC37 | next", roots);
  assert.equal(bare.kind === "run" && bare.invocation.args[1]!.length, 0); // no operator typed: press by default (the module's call)
  assert.deepEqual(bare.kind === "run" && bare.invocation.args[2], ["next"]);
  const learn = parse("map --learn toggle | mute #fx --set {}", roots);
  assert.equal(learn.kind === "run" && learn.invocation.options.learn, true);
  // words fill the arguments in order: with --learn there is no control word, so `toggle` lands in the first slot (the map module reads it)
  assert.deepEqual(learn.kind === "run" && learn.invocation.args, [["toggle"], [], ["mute #fx --set {}"]]);
});

test("parse: a missing or empty binding is a usage error naming the argument; `--help` still works", () => {
  const roots = [mapNode, other];
  for (const line of ["map CC37", "map CC37 |", "map CC37 |   "]) {
    const out = parse(line, roots);
    assert.equal(out.kind, "error", line);
    if (out.kind === "error") {
      assert.equal(out.result.code, ExitCode.USAGE);
      assert.match(out.result.message!, /missing argument <line>/);
    }
  }
  assert.equal(parse("map --help", roots).kind, "help");
  assert.equal(parse("map CC37 --help | x", roots).kind, "help");
});

test("a `|` in a command without a raw argument is a usage error (quote it to use it as text)", () => {
  const out = parse("note buy milk | eggs", [mapNode, other]);
  assert.equal(out.kind, "error");
  if (out.kind === "error") {
    assert.equal(out.result.code, ExitCode.USAGE);
    assert.match(out.result.message!, /"\|" is only for commands that take a command line \(quote it to use it as text\)/);
  }
  const quoted = parse('note "buy milk | eggs"', [mapNode, other]);
  assert.equal(quoted.kind === "run" && quoted.invocation.args[0]![0], "buy milk | eggs");
  assert.equal(parse("mute a | b", [mute]).kind, "error");
});

test("a mapped line round trips through runLine: the binding is run text, remembered behind the bar", async () => {
  const registry = new CommandRegistry();
  const seen: string[][] = [];
  registry.add({ ...mapNode, run: (inv: { args: unknown[][] }) => void seen.push(inv.args.map((a) => String(a[0] ?? ""))) } as never);
  const deps: RunDeps = { registry, liveNodes: () => [], pick: async () => null, log: () => {} };
  const out = await runLine("map CC37 toggle | mute #a --set {}; solo #b", deps);
  assert.equal(out.result.code, ExitCode.OK);
  assert.deepEqual(seen, [["CC37", "toggle", "mute #a --set {}; solo #b"]]);
  assert.equal(out.line, "map CC37 toggle | mute #a --set {}; solo #b");
  const chained = await runLine("map CC1 | a; map CC2 | b; c", deps);
  assert.equal(chained.result.code, ExitCode.OK);
  assert.equal(seen.length, 2); // `map CC1 | a; map CC2 | b; c` is ONE part: the binding swallows the rest
  assert.deepEqual(seen[1], ["CC1", "", "a; map CC2 | b; c"]);
});

test("validateTree: raw is the last argument of kind text, nothing else; usage shows the bar", () => {
  assert.deepEqual(validateTree([mapNode]), []);
  assert.match(validateTree([{ ...mapNode, args: [{ name: "x", kind: "text", raw: true }, { name: "y", kind: "text" }] }]).join("\n"), /only the last argument may take the text after "\|"/);
  assert.match(validateTree([{ ...mapNode, args: [{ name: "x", kind: "path", raw: true }] }]).join("\n"), /must be of kind text/);
  assert.match(validateTree([{ ...mapNode, args: [{ name: "x", kind: "text", raw: true, rest: true }] }]).join("\n"), /cannot be rest, variadic or have choices/);
  assert.equal(usage(mapNode, ["map"]), "map [--learn] [<control>] [<press|release|hold|toggle>] | <line>");
});

const data = (roots: CommandNode<any, any>[]): CompletionData => ({ tree: completionTree(roots), completions: {}, paths: [], tags: [] });

test("completion: after the bar a new command line starts; before it the raw argument is no positional word", () => {
  const d = data([mapNode, other, mute]);
  const at = (text: string) => {
    const bar = text.indexOf("^");
    const line = bar < 0 ? text : text.slice(0, bar) + text.slice(bar + 1);
    return complete(line, bar < 0 ? line.length : bar, d);
  };
  const after = at("map CC37 toggle | ");
  assert.deepEqual(after.items.map((i) => i.label), ["map", "note", "mute"]);
  assert.deepEqual(after.replace, { from: 18, to: 18 });
  assert.deepEqual(at("map CC37 | mu").items.map((i) => i.label), ["mute"]);
  assert.deepEqual(at("map CC37 | mute --").items.map((i) => i.label), ["--help"]);
  assert.deepEqual(at("map CC37 | mute x; mu").items.map((i) => i.label), ["mute"]); // the binding's own chain
  // after the last positional the bar is hinted, and the operator choices come first
  assert.equal(at("map CC37 toggle ").usage, "| <line>");
  assert.deepEqual(at("map CC37 ").items.filter((i) => i.kind === "value").map((i) => i.label), ["press", "release", "hold", "toggle"]);
  // a cursor before the bar completes the head
  assert.deepEqual(at("map CC37 to^ | mute").items.filter((i) => i.kind === "value").map((i) => i.label), ["toggle"]);
});

// ── a group with a fallback child: `map CC37 | …` beside `map learn | …` ──────────────────────────────

const mapGroup: CommandNode<any, any> = {
  name: "map",
  summary: "bind controls",
  children: [
    { name: "learn", summary: "learn a control", args: [{ name: "operator", kind: "enum", choices: ["press", "release", "hold", "toggle"], required: false }, { name: "line", kind: "text", raw: true }], run },
    {
      name: "add",
      summary: "bind a control",
      fallback: true,
      options: [{ name: "list", short: "l", summary: "list" }, { name: "rm", takesValue: true, number: { integer: true, min: 1 }, summary: "remove" }],
      args: [{ name: "control", kind: "text", required: false }, { name: "operator", kind: "enum", choices: ["press", "release", "hold", "toggle"], required: false }, { name: "line", kind: "text", raw: true, required: false }],
      run,
    },
  ],
};

test("fallback: words that are no subcommand run the fallback child; the subcommand still wins; options go to the fallback", () => {
  const roots = [mapGroup];
  const bind = parse("map CC37 hold | mute #a --set {}", roots);
  assert.equal(bind.kind === "run" && bind.node.name, "add");
  assert.deepEqual(bind.kind === "run" && bind.invocation.path, ["map"]); // the group's path
  assert.deepEqual(bind.kind === "run" && bind.invocation.args, [["CC37"], ["hold"], ["mute #a --set {}"]]);
  const learn = parse("map learn toggle | mute #fx --set {}", roots);
  assert.equal(learn.kind === "run" && learn.node.name, "learn");
  assert.deepEqual(learn.kind === "run" && learn.invocation.args, [["toggle"], ["mute #fx --set {}"]]);
  const list = parse("map -l", roots);
  assert.equal(list.kind === "run" && list.node.name, "add");
  assert.equal(list.kind === "run" && list.invocation.options.list, true);
  const rm = parse("map --rm 2", roots);
  assert.deepEqual(rm.kind === "run" && rm.invocation.options.rm, "2");
  assert.equal(parse("map add CC1 | x", roots).kind, "run"); // by its own name too
  assert.equal(parse("map", roots).kind, "help"); // a bare group: its help
  assert.equal(parse("map --help", roots).kind, "help");
});

test("validateTree: one fallback per group, a runnable leaf, inside a group", () => {
  assert.deepEqual(validateTree([mapGroup]), []);
  const twice = { ...mapGroup, children: mapGroup.children!.map((c) => ({ ...c, fallback: true })) };
  assert.match(validateTree([twice]).join("\n"), /only one subcommand may be the fallback/);
  assert.match(validateTree([{ ...mapNode, fallback: true }]).join("\n"), /a fallback needs a group above it/);
});

test("completion with a fallback: subcommands at the first word, the fallback's positions after a non-subcommand word", () => {
  const d = data([mapGroup]);
  const at = (text: string) => {
    const bar = text.indexOf("^");
    const line = bar < 0 ? text : text.slice(0, bar) + text.slice(bar + 1);
    return complete(line, bar < 0 ? line.length : bar, d);
  };
  assert.deepEqual(at("map ").items.map((i) => i.label), ["learn", "add"]);
  assert.deepEqual(at("map -").items.map((i) => i.label), ["--list", "--rm", "--help"]); // the fallback's options
  const afterControl = at("map CC37 ");
  assert.deepEqual(afterControl.items.filter((i) => i.kind === "value").map((i) => i.label), ["press", "release", "hold", "toggle"]);
  assert.deepEqual(at("map CC37 hold ").usage, "| <line>");
  assert.deepEqual(at("map learn ").items.filter((i) => i.kind === "value").map((i) => i.label), ["press", "release", "hold", "toggle"]);
  assert.deepEqual(at("map CC37 | mu").items.length, 0); // no `mu` command in this tree
});

test("a bare `|` on a group with a fallback goes to the fallback and answers what is missing (not the group's help)", () => {
  const out = parse("map | next", [mapGroup]);
  assert.equal(out.kind, "run"); // `add` has an optional control; a required one would answer "missing argument"
  assert.equal(out.kind === "run" && out.node.name, "add");
});
