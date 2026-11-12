import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parse.js";
import { shortHelpText, usage, validateTree, completionTree, type CommandNode } from "./commandTree.js";
import { bareBehaviour } from "./defaultCommands.js";

// Runnable groups (plan 0005, "the `git stash` rule"): a fallback child marked `bare` runs when its group is typed alone.

const run = () => undefined;
const open: CommandNode<any, any> = {
  name: "open",
  summary: "open the note",
  fallback: true,
  bare: true,
  options: [{ name: "edit", short: "e", summary: "edit" }],
  args: [{ name: "text", kind: "text", rest: true, required: false }],
  run,
};
const add: CommandNode<any, any> = { name: "add", summary: "add a stamp", fallback: true, bare: true, args: [{ name: "text", kind: "text", rest: true, required: false }], run };
const note: CommandNode<any, any> = {
  name: "note",
  summary: "the note",
  children: [
    open,
    { name: "stamp", summary: "stamps", children: [add, { name: "list", summary: "list stamps", run }] },
    { name: "loop", summary: "loop", run },
  ],
};
// A fallback without `bare`, like `find`, and a map-like group.
const find: CommandNode<any, any> = {
  name: "find",
  summary: "find",
  children: [
    { name: "next", summary: "next", run },
    { name: "search", summary: "search", fallback: true, args: [{ name: "q", kind: "text", rest: true, required: false }], run },
  ],
};

test("bare: the group typed alone runs its bare fallback, with the group's path", () => {
  const out = parse("note", [note]);
  assert.equal(out.kind === "run" && out.node.name, "open");
  assert.deepEqual(out.kind === "run" && out.invocation.path, ["note"]);
});

test("bare: options and words after the group go to the bare child", () => {
  const e = parse("note -e", [note]);
  assert.equal(e.kind === "run" && e.node.name, "open");
  assert.equal(e.kind === "run" && e.invocation.options.edit, true);
  const w = parse("note hello world", [note]);
  assert.deepEqual(w.kind === "run" && w.invocation.args, [["hello world"]]);
  assert.equal(parse("note loop", [note]).kind === "run" && (parse("note loop", [note]) as any).node.name, "loop"); // a subcommand still wins
});

test("bare: --help on the group still prints help, naming the child that runs bare", () => {
  const out = parse("note --help", [note]);
  assert.equal(out.kind, "help");
  const text = shortHelpText(note, ["note"]);
  assert.match(text, /usage: note \[<command>\]/);
  assert.match(text, /typed alone, `note` runs `open`/);
});

test("bare: nested — `note stamp` runs add, `note stamp list` still lists", () => {
  const out = parse("note stamp", [note]);
  assert.equal(out.kind === "run" && out.node.name, "add");
  assert.deepEqual(out.kind === "run" && out.invocation.path, ["note", "stamp"]);
  const text = parse("note stamp my label", [note]);
  assert.deepEqual(text.kind === "run" && text.invocation.args, [["my label"]]);
  assert.equal(parse("note stamp list", [note]).kind === "run" && (parse("note stamp list", [note]) as any).node.name, "list");
  assert.equal(parse("note stamp --help", [note]).kind, "help");
});

test("a group without bare still prints its help (find unchanged), words go to the fallback", () => {
  assert.equal(parse("find", [find]).kind, "help");
  const w = parse("find kick", [find]);
  assert.equal(w.kind === "run" && w.node.name, "search");
  assert.match(usage(find, ["find"]), /^find <command>$/);
  assert.doesNotMatch(shortHelpText(find, ["find"]), /typed alone/);
  assert.equal(bareBehaviour(find), "shows its subcommands");
  assert.notEqual(bareBehaviour(note), "shows its subcommands");
});

test("validateTree: bare needs fallback; a valid bare tree has no problems; completion tree carries bare", () => {
  assert.deepEqual(validateTree([note]), []);
  const bad: CommandNode<any, any> = { name: "g", summary: "g", children: [{ name: "x", summary: "x", bare: true, run }] };
  assert.match(validateTree([bad]).join("\n"), /bare needs fallback: true/);
  assert.equal(completionTree([note])[0]!.children![0]!.bare, true);
});

test("the nested help names the full path", () => {
  const stamp = note.children![1]!;
  assert.match(shortHelpText(stamp, ["note", "stamp"]), /typed alone, `note stamp` runs `add`/);
});
