import { test } from "node:test";
import assert from "node:assert/strict";
import { complete, locate, MAX_ROWS, type CompletionData, type PathRow } from "./complete.js";
import { completionTree, type CommandNode } from "./commandTree.js";
import { tokenize } from "./tokenize.js";

const run = () => undefined;
const tree: CommandNode<any, any>[] = [
  {
    name: "mute",
    summary: "mute tracks",
    aliases: ["silence"],
    options: [
      { name: "set", short: "s", takesValue: true, choices: ["0", "1"], summary: "set the state" },
      { name: "delay", takesValue: true, number: { min: 0, max: 10 }, summary: "wait" },
      { name: "quiet", short: "q", summary: "say nothing" },
    ],
    args: [{ name: "target", kind: "path", variadic: true, summary: "what to mute" }],
    run,
  },
  {
    name: "goto",
    summary: "select an object",
    args: [{ name: "path", kind: "path", rest: true }],
    run,
  },
  {
    name: "tag",
    summary: "tag tracks",
    options: [
      { name: "rename", short: "r", takesValue: true, values: 2, valueLabels: ["old", "new"], complete: "tags", summary: "rename a tag" },
      { name: "edit", short: "e", takesValue: true, valueDefault: "#", complete: "tags", summary: "edit tags" },
    ],
    args: [
      { name: "tag", kind: "text", complete: "tags" },
      { name: "targets", kind: "path", required: false, variadic: true, kinds: ["track"] },
    ],
    run,
  },
  {
    name: "vol",
    summary: "set a volume",
    options: [{ name: "to", takesValue: true, number: {}, summary: "target" }, { name: "one", short: "1", summary: "digit short" }],
    args: [{ name: "value", kind: "number" }, { name: "target", kind: "path", rest: true }],
    run,
  },
  {
    name: "pakabl",
    summary: "extensions",
    children: [
      { name: "install", summary: "install one", args: [{ name: "id", kind: "enum", complete: "ids" }], run },
      { name: "list", summary: "list them", run },
    ],
  },
  { name: "mode", summary: "pick a mode", args: [{ name: "kind", kind: "enum", choices: ["fast", "slow", "Safe Mode"] }], run },
];

const paths: PathRow[] = [
  { path: "/Drums", name: "Drums", kind: "track" },
  { path: "/Drums/Kick#1", name: "Kick", kind: "device" },
  { path: "/Drums/Kick#2", name: "Kick", kind: "device" },
  { path: "/2-808 Core Kit", name: "2-808 Core Kit", kind: "track" },
  { path: "/2-808 Core Kit/808 Core Kit/Snare Drum", name: "Snare Drum", kind: "chain" },
  { path: "/Lead", name: "Lead", kind: "track" },
];

const data: CompletionData = {
  tree: completionTree(tree),
  completions: {
    tags: [{ label: "fx", description: "2 tracks" }, { label: "drums" }, { label: "bass line", insert: "bass line" }],
    ids: [{ label: "alpha" }, { label: "beta" }],
  },
  paths,
  tags: [
    { name: "drums", count: 2 },
    { name: "fx", count: 1 },
  ],
};

/** Complete at the end of `line`, or at the `|` marker when there is one. */
function at(text: string, d: CompletionData = data) {
  const bar = text.indexOf("|");
  const line = bar < 0 ? text : text.slice(0, bar) + text.slice(bar + 1);
  const result = complete(line, bar < 0 ? line.length : bar, d);
  return { ...result, line, labels: result.items.map((i) => i.label), inserts: result.items.map((i) => i.insert) };
}
const where = (text: string) => {
  const bar = text.indexOf("|");
  const line = bar < 0 ? text : text.slice(0, bar) + text.slice(bar + 1);
  return locate(line, tokenize(line).tokens, bar < 0 ? line.length : bar, tree);
};

test("an empty line lists the commands; a prefix filters them, names first", () => {
  assert.deepEqual(at("").labels, ["mute", "goto", "tag", "vol", "pakabl", "mode"]);
  assert.deepEqual(at("mo").labels, ["mode"]);
  assert.deepEqual(at("m").labels, ["mute", "mode"]);
  assert.equal(at("m").items[0]!.kind, "command");
  assert.deepEqual(at("m").replace, { from: 0, to: 1 });
});

test("an alias that fits is offered as its own row", () => {
  assert.deepEqual(at("sil").labels, ["silence"]);
  assert.equal(at("sil").items[0]!.insert, "silence");
  assert.match(at("sil").items[0]!.description!, /^mute: /);
  assert.deepEqual(at("mu").labels, ["mute"]); // the name fits: no extra alias row
});

test("subcommands of a group, with a <command> hint", () => {
  const r = at("pakabl ");
  assert.deepEqual(r.labels, ["install", "list"]);
  assert.equal(r.usage, "<command>");
  assert.deepEqual(at("pakabl ins").labels, ["install"]);
  assert.deepEqual(at("pakabl i").labels, ["install", "list"]); // "list" holds an i, ranked after the prefix
  assert.deepEqual(at("pakabl i").replace, { from: 7, to: 8 });
});

test("an unknown command or subcommand offers nothing", () => {
  assert.deepEqual(at("nope ").items, []);
  assert.deepEqual(at("pakabl bogus ").items, []);
  assert.equal(where("nope ").where.at, "none");
});

test("options: a bare dash lists them (not --help twice), a prefix filters, used ones are hidden", () => {
  const all = at("mute -");
  assert.deepEqual(all.labels, ["--set", "--delay", "--quiet", "--pick", "--help"]);
  assert.deepEqual(at("mute --d").labels, ["--delay"]);
  assert.deepEqual(at("mute -q -").labels, ["--set", "--delay", "--pick", "--help"]);
  assert.equal(at("mute --d").items[0]!.kind, "option");
  assert.match(at("mute --s").items[0]!.description!, /^-s /);
  // a short letter finds its option
  assert.deepEqual(at("mute -s").labels, ["--set"]);
});

test("a bare `-` is an option, `-6` is a value (a number is never an option)", () => {
  assert.equal(where("vol -").where.at, "option");
  assert.equal(where("vol -6").where.at, "arg");
  assert.equal(where("vol -inf").where.at, "arg");
  // unless the command declares exactly that digit as a short option
  assert.equal(where("vol -1").where.at, "option");
  assert.deepEqual(at("vol -6").items, []); // a number argument offers nothing but the hint
  assert.equal(at("vol -6").usage, "<value>");
});

test("option values: choices, number hint, completer rows", () => {
  const set = at("mute --set ");
  assert.deepEqual(set.labels, ["0", "1"]);
  assert.equal(set.usage, "<0|1>");
  assert.deepEqual(at("mute -s 1").labels, ["1"]);
  const num = at("mute --delay ");
  assert.deepEqual(num.items, []);
  assert.equal(num.usage, "<n>");
});

test("--name=value: the value is completed after the = and replaces only it", () => {
  const r = at("mute --set=1");
  assert.deepEqual(r.labels, ["1"]);
  assert.deepEqual(r.replace, { from: 11, to: 12 });
  const q = at('tag --edit="bass');
  assert.deepEqual(q.labels, ["bass line"]);
  assert.equal(q.inserts[0], '"bass line"');
  assert.deepEqual(q.replace, { from: 11, to: 16 });
  assert.equal(at("mute --quiet=").items.length, 0); // a flag takes no value
});

test("multi-value options: each value in turn has its own hint, and the key serves both", () => {
  const first = at("tag --rename ");
  assert.equal(first.usage, "<old>");
  assert.deepEqual(first.labels, ["fx", "drums", "bass line"]);
  const second = at("tag --rename fx ");
  assert.equal(second.usage, "<new>");
  assert.equal(second.items.length, 3);
  const after = at("tag --rename fx fx2 ");
  assert.equal(after.usage, "<tag>"); // both values given: the positional argument follows
  assert.equal(where("tag --rename fx fx2 ").where.at, "arg");
  // an inline first value leaves one more
  assert.equal(at("tag --rename=fx ").usage, "<new>");
});

test("a value option with a default: a value or the next option", () => {
  assert.equal(where("tag -e ").where.at, "optionValue");
  assert.equal(where("tag -e -").where.at, "option");
  assert.equal(where("tag -e fx ").where.at, "arg");
  assert.equal(where("tag -e fx").where.at, "optionValue");
});

test("positional arguments in order, with kinds and hints", () => {
  const first = at("tag ");
  assert.equal(first.usage, "<tag>");
  assert.deepEqual(first.labels, ["fx", "drums", "bass line"]);
  const second = at("tag fx ");
  assert.equal(second.usage, "[<targets>…]");
  assert.deepEqual(second.labels, ["/Drums", "/2-808 Core Kit", "/Lead"]); // kinds: ["track"] drops devices and chains
});

test("enum arguments: choices, case ignored, quoted when they need it", () => {
  assert.deepEqual(at("mode ").labels, ["fast", "slow", "Safe Mode"]);
  assert.deepEqual(at("mode SA").labels, ["Safe Mode"]);
  assert.equal(at("mode sa").inserts[0], '"Safe Mode"');
  assert.equal(at("mode ").usage, "<fast|slow|Safe Mode>");
  assert.deepEqual(at("pakabl install ").labels, ["alpha", "beta"]); // a dynamic enum: completer rows
});

test("an extra argument offers nothing", () => {
  assert.deepEqual(at("mode fast ").items, []);
  assert.deepEqual(at("mode fast x").items, []);
});

test("paths: whole-path match, own-name prefix first, unique paths inserted and quoted", () => {
  const r = at("mute kick");
  assert.deepEqual(r.labels, ["/Drums/Kick#1", "/Drums/Kick#2"]);
  assert.deepEqual(r.inserts, ["/Drums/Kick#1", "/Drums/Kick#2"]);
  assert.deepEqual(r.items.map((i) => i.kind), ["path", "path"]);
  assert.deepEqual(r.items.map((i) => i.description), ["device", "device"]);
  // a space in the path: quoted on insert
  assert.equal(at("mute 808").inserts[0], '"/2-808 Core Kit"');
  // prefix match before substring
  // the object's own name first (prefix, then a word of it), objects below a parent that fits last
  assert.deepEqual(at("mute dr").labels, ["/Drums", "/2-808 Core Kit/808 Core Kit/Snare Drum", "/Drums/Kick#1", "/Drums/Kick#2"]);
});

test("a rest argument takes several words as one value: the whole range is replaced", () => {
  const r = at("goto snare dr");
  assert.deepEqual(r.labels, ["/2-808 Core Kit/808 Core Kit/Snare Drum"]);
  assert.equal(r.inserts[0], '"/2-808 Core Kit/808 Core Kit/Snare Drum"');
  assert.deepEqual(r.replace, { from: 5, to: 13 });
  assert.equal(at("goto snare ").items.length, 1); // trailing space: still the same value
  assert.equal(r.usage, "<path>");
  // a rest argument as the second argument starts at its own first word
  const v = at("vol -6 snare dr");
  assert.deepEqual(v.replace, { from: 7, to: 15 });
  assert.equal(v.items.length, 1);
});

test("#tag targets: tags are listed for a path argument, a `!` negates, a rest argument has none", () => {
  const r = at("mute #");
  assert.deepEqual(r.labels, ["#drums", "#fx"]);
  assert.deepEqual(r.items.map((i) => i.kind), ["tag", "tag"]);
  assert.deepEqual(r.items.map((i) => i.description), ["2 tracks", "1 track"]);
  assert.deepEqual(at("mute #f").labels, ["#fx"]);
  assert.deepEqual(at("mute !#d").labels, ["!#drums"]);
  assert.deepEqual(at("mute #f").replace, { from: 5, to: 7 });
  assert.deepEqual(at("goto #f").items, []);
  assert.deepEqual(at('mute "#f').items.filter((i) => i.kind === "tag"), []); // a quoted word is text
});

test("a cursor inside an open quote completes the partial word and closes the quote on insert", () => {
  const r = at('mute "/2-808 Co');
  assert.deepEqual(r.labels, ["/2-808 Core Kit", "/2-808 Core Kit/808 Core Kit/Snare Drum"]);
  assert.equal(r.inserts[0], '"/2-808 Core Kit"');
  assert.deepEqual(r.replace, { from: 5, to: 15 });
});

test("a cursor in the middle: the word under it is replaced whole, matched by what is before the cursor", () => {
  const r = at("mute ki|ck /Lead");
  assert.deepEqual(r.labels.slice(0, 2), ["/Drums/Kick#1", "/Drums/Kick#2"]);
  assert.deepEqual(r.replace, { from: 5, to: 9 });
  // in whitespace between words: a new word, nothing replaced
  const end = at("mute /Lead| /Drums"); // the end of a word still belongs to it
  assert.deepEqual(end.replace, { from: 5, to: 10 });
  const between = at("mute /Lead |/Drums");
  assert.deepEqual(between.replace, { from: 11, to: 11 });
  assert.equal(between.items.length, 6); // all paths: nothing typed
  // the command word in the middle of the line
  assert.deepEqual(at("mu|te /Lead").labels, ["mute"]);
  assert.deepEqual(at("mu|te /Lead").replace, { from: 0, to: 4 });
});

test("before the first word: a new word is started in front of the line", () => {
  const r = at("| mute");
  assert.deepEqual(r.replace, { from: 0, to: 0 });
  assert.equal(r.items.length, 6);
});

test("`--` ends the options: the rest is positional text", () => {
  assert.equal(where("mute -- -").where.at, "arg");
  assert.equal(where("mute -- --s").where.at, "arg");
});

test("a word the options consume is not a positional one", () => {
  // `--set 1` consumes 1; the next word is the first target
  assert.equal(where("mute --set 1 ").where.at, "arg");
  const w = where("tag --edit fx fx2 ");
  assert.equal(w.where.at, "arg");
});

test("caps: at most MAX_ROWS rows per level, best first", () => {
  const many: PathRow[] = Array.from({ length: 400 }, (_, i) => ({ path: `/T${i}`, name: `T${i}`, kind: "track" as const }));
  const big = { ...data, paths: many };
  assert.equal(at("mute ", big).items.length, MAX_ROWS);
  assert.equal(at("mute T1", big).items[0]!.label, "/T1");
  const tags = { ...data, tags: Array.from({ length: 300 }, (_, i) => ({ name: `t${i}`, count: 1 })) };
  assert.equal(at("mute #", tags).items.length, MAX_ROWS);
  const rows = { ...data, completions: { tags: Array.from({ length: 300 }, (_, i) => ({ label: `x${i}` })) } };
  assert.equal(at("tag ", rows).items.length, MAX_ROWS);
});

test("nothing throws: junk data and odd input give an empty result", () => {
  const junk = { tree: [{ name: "x", summary: "y" }], completions: {}, paths: [], tags: [] } as unknown as CompletionData;
  assert.deepEqual(at("x ", junk).items, []);
  assert.deepEqual(complete("mute ", 99, data).replace, { from: 5, to: 5 });
  assert.deepEqual(complete("mute ", -4, data).replace.from, 0);
  assert.doesNotThrow(() => complete("\\", 1, data));
  assert.doesNotThrow(() => complete('"', 1, { ...data, tree: undefined as never }));
  assert.deepEqual(complete("tag ", 4, { ...data, completions: undefined as never }).items, []);
});

test("completer rows: strings and objects, insert quoted, bad entries skipped", () => {
  const d = { ...data, completions: { tags: ["a b", { label: "shown", insert: "real value" }, { label: "" }, 3, null] as never } }; // a page gets normalized rows; be forgiving anyway
  const r = at("tag ", d);
  assert.deepEqual(r.labels, ["a b", "shown"]);
  assert.deepEqual(r.inserts, ['"a b"', '"real value"']);
});
