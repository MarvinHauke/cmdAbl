import { test } from "node:test";
import assert from "node:assert/strict";
import { complete, locate, MAX_ROWS, type CompletionData, type PathRow } from "./complete.js";
import { completionTree, type CommandNode } from "../command/commandTree.js";
import { tokenize } from "../command/tokenize.js";

const run = () => undefined;
const tree: CommandNode<any, any>[] = [
  { name: "ranked", summary: "tracks and chains", args: [{ name: "t", kind: "path", kinds: ["track", "chain"], variadic: true }], run },
  { name: "note", summary: "a note", options: [{ name: "edit", short: "e", summary: "edit it" }], run },
  { name: "plain", summary: "no options, no args", run },
  { name: "grp", summary: "a group", children: [{ name: "clear", summary: "clear it", run }] },
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
  const labelsOf = (zone: "tool" | "set") => result.items.filter((i) => i.zone === zone).map((i) => i.label);
  return { ...result, line, labels: result.items.map((i) => i.label), inserts: result.items.map((i) => i.insert), toolLabels: labelsOf("tool"), setLabels: labelsOf("set") };
}
const where = (text: string) => {
  const bar = text.indexOf("|");
  const line = bar < 0 ? text : text.slice(0, bar) + text.slice(bar + 1);
  return locate(line, tokenize(line).tokens, bar < 0 ? line.length : bar, tree);
};

test("an empty line lists the commands; a prefix filters them, names first", () => {
  assert.deepEqual(at("").labels, ["ranked", "note", "plain", "grp", "mute", "goto", "tag", "vol", "pakabl", "mode"]);
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
  assert.deepEqual(first.setLabels, ["fx", "drums", "bass line"]);
  const second = at("tag fx ");
  assert.equal(second.usage, "[<targets>…]");
  assert.deepEqual(second.setLabels, ["/Drums", "/2-808 Core Kit", "/Lead"]); // kinds: ["track"] drops devices and chains
});

test("enum arguments: choices, case ignored, quoted when they need it", () => {
  assert.deepEqual(at("mode ").setLabels, ["fast", "slow", "Safe Mode"]);
  assert.deepEqual(at("mode SA").setLabels, ["Safe Mode"]);
  assert.equal(at("mode sa").inserts[0], '"Safe Mode"');
  assert.equal(at("mode ").usage, "<fast|slow|Safe Mode>");
  assert.deepEqual(at("pakabl install ").setLabels, ["alpha", "beta"]); // a dynamic enum: completer rows
});

test("an extra argument offers nothing", () => {
  assert.deepEqual(at("mode fast ").setLabels, []);
  assert.deepEqual(at("mode fast ").toolLabels, ["--help"]); // only the options are left to offer
  assert.deepEqual(at("mode fast x").setLabels, []);
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
  assert.deepEqual(r.setLabels.slice(0, 2), ["/Drums/Kick#1", "/Drums/Kick#2"]);
  assert.deepEqual(r.replace, { from: 5, to: 9 });
  // in whitespace between words: a new word, nothing replaced
  const end = at("mute /Lead| /Drums"); // the end of a word still belongs to it
  assert.deepEqual(end.replace, { from: 5, to: 10 });
  const between = at("mute /Lead |/Drums");
  assert.deepEqual(between.replace, { from: 11, to: 11 });
  assert.equal(between.setLabels.length, 6); // all paths: nothing typed
  // the command word in the middle of the line
  assert.deepEqual(at("mu|te /Lead").toolLabels, ["mute"]);
  assert.deepEqual(at("mu|te /Lead").replace, { from: 0, to: 4 });
});

test("before the first word: a new word is started in front of the line", () => {
  const r = at("| mute");
  assert.deepEqual(r.replace, { from: 0, to: 0 });
  assert.equal(r.items.length, 10);
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
  assert.equal(at("mute ", big).setLabels.length, MAX_ROWS);
  assert.equal(at("mute ", big).toolLabels.length, 5); // the tool zone has its own cap, not shared
  assert.equal(at("mute T1", big).items[0]!.label, "/T1");
  const tags = { ...data, tags: Array.from({ length: 300 }, (_, i) => ({ name: `t${i}`, count: 1 })) };
  assert.equal(at("mute #", tags).setLabels.length, MAX_ROWS);
  const rows = { ...data, completions: { tags: Array.from({ length: 300 }, (_, i) => ({ label: `x${i}` })) } };
  assert.equal(at("tag ", rows).setLabels.length, MAX_ROWS);
});

test("nothing throws: junk data and odd input give an empty result", () => {
  const junk = { tree: [{ name: "x", summary: "y" }], completions: {}, paths: [], tags: [] } as unknown as CompletionData;
  assert.deepEqual(at("x ", junk).setLabels, []);
  assert.deepEqual(complete("mute ", 99, data).replace, { from: 5, to: 5 });
  assert.deepEqual(complete("mute ", -4, data).replace.from, 0);
  assert.doesNotThrow(() => complete("\\", 1, data));
  assert.doesNotThrow(() => complete('"', 1, { ...data, tree: undefined as never }));
  assert.deepEqual(complete("tag ", 4, { ...data, completions: undefined as never }).items, []);
});

test("completer rows: strings and objects, insert quoted, bad entries skipped", () => {
  const d = { ...data, completions: { tags: ["a b", { label: "shown", insert: "real value" }, { label: "" }, 3, null] as never } }; // a page gets normalized rows; be forgiving anyway
  const r = at("tag ", d);
  assert.deepEqual(r.setLabels, ["a b", "shown"]);
  assert.deepEqual(r.items.filter((i) => i.zone === "set").map((i) => i.insert), ['"a b"', '"real value"']);
});

test("usage of a multi-value option without a completer still names each value (<old>, then <new>)", () => {
  const plain: CommandNode<any, any>[] = [
    { name: "tag", summary: "t", options: [{ name: "rename", short: "r", takesValue: true, values: 2, valueLabels: ["old", "new"], summary: "r" }], run },
  ];
  const d: CompletionData = { tree: completionTree(plain), completions: {}, paths: [], tags: [] };
  for (const [line, hint] of [["tag --rename ", "<old>"], ["tag -r ", "<old>"], ["tag -r fx ", "<new>"], ["tag --rename=fx ", "<new>"]] as const) {
    assert.equal(complete(line, line.length, d).usage, hint, line);
  }
  // no labels declared: "value" for each
  const bare = completionTree([{ name: "x", summary: "s", options: [{ name: "pair", takesValue: true, values: 2, summary: "p" }], run }]);
  assert.equal(complete("x --pair ", 9, { ...d, tree: bare }).usage, "<value>");
});

test("two zones: a positional position returns the unused options (tool) and the targets (set), tool rows first", () => {
  const r = at("tag ");
  assert.deepEqual(r.toolLabels, ["--rename", "--edit", "--pick", "--help"]);
  assert.deepEqual(r.setLabels, ["fx", "drums", "bass line"]);
  assert.deepEqual(r.items.map((i) => i.zone), ["tool", "tool", "tool", "tool", "set", "set", "set"]);
  assert.deepEqual([...new Set(r.items.map((i) => [i.kind, i.zone].join("/")))], ["option/tool", "value/set"]);
  assert.equal(at("mute #").items.find((i) => i.kind === "tag")!.zone, "set");
  assert.equal(at("mute ").items.find((i) => i.kind === "path")!.zone, "set");
  assert.equal(at("m").items[0]!.zone, "tool");
});

test("two zones: options already typed are not offered again, and each zone is ranked on its own", () => {
  assert.deepEqual(at("tag --edit fx ").toolLabels.includes("--edit"), false);
  assert.deepEqual(at("mute del").toolLabels, ["--delay"]); // an option name that fits the typed text
  const r = at("mute dr");
  assert.deepEqual(r.toolLabels, []);
  assert.equal(r.setLabels[0], "/Drums"); // the paths are ranked without the options
  assert.deepEqual(at("mute /Dr").toolLabels, []); // a path-like word fits no option
});

test("two zones: nothing but the value while an option waits for it", () => {
  assert.deepEqual(at("tag --rename ").toolLabels, []);
  assert.deepEqual(at("tag --rename ").setLabels, ["fx", "drums", "bass line"]);
  assert.deepEqual(at("mute --set ").toolLabels, []); // choices only
  assert.deepEqual(at("mute --set ").setLabels, ["0", "1"]);
  assert.deepEqual(at("mute --delay ").toolLabels, []);
});

test("two zones: no options after `--` or inside a rest value; a bare dash narrows to options", () => {
  assert.deepEqual(at("tag -- ").toolLabels, []);
  assert.deepEqual(at("tag -- ").setLabels, ["fx", "drums", "bass line"]);
  assert.deepEqual(at("goto snare ").toolLabels, []); // words already typed belong to the one value
  assert.deepEqual(at("goto ").toolLabels, ["--pick", "--help"]); // before the first word they are offered
  const dash = at("tag -");
  assert.deepEqual(dash.setLabels, []);
  assert.deepEqual(dash.toolLabels, ["--rename", "--edit", "--pick", "--help"]);
});

test("two zones: a group offers its subcommands (tool zone); the cap is per zone", () => {
  const r = at("pakabl ");
  assert.deepEqual(r.toolLabels, ["install", "list"]);
  assert.deepEqual(r.items.map((i) => i.zone), ["tool", "tool"]);
  const many: PathRow[] = Array.from({ length: 400 }, (_, i) => ({ path: `/T${i}`, name: `T${i}`, kind: "track" as const }));
  const big = at("mute ", { ...data, paths: many });
  assert.equal(big.setLabels.length, MAX_ROWS);
  assert.ok(big.toolLabels.length > 0 && big.toolLabels.length <= MAX_ROWS);
});

test("a command without arguments (or after its last one) still offers its unused options", () => {
  assert.deepEqual(at("note ").toolLabels, ["--edit", "--help"]);
  assert.deepEqual(at("note ").setLabels, []);
  assert.equal(at("note ").usage, undefined);
  assert.deepEqual(at("note -e ").toolLabels, ["--help"]); // --edit is used
  assert.deepEqual(at("note --e").toolLabels, ["--edit", "--help"]); // prefix first, "help" holds an e
  assert.deepEqual(at("plain ").toolLabels, ["--help"]); // no options of its own
  assert.deepEqual(at("grp clear ").toolLabels, ["--help"]); // a leaf below a group
  assert.deepEqual(at("note -- ").items, []); // after `--` none
  assert.deepEqual(at("mode fast ").toolLabels, ["--help"]); // after its last argument
  assert.equal(where("note ").where.at, "options");
});

test("`;` chains: after `; ` completion starts again at the command, and works on the part the caret is in", () => {
  const after = at("mute /Lead; ");
  assert.deepEqual(after.toolLabels, ["ranked", "note", "plain", "grp", "mute", "goto", "tag", "vol", "pakabl", "mode"]);
  assert.deepEqual(after.replace, { from: 12, to: 12 });
  assert.deepEqual(at("mute /Lead;to").toolLabels, ["goto"]); // no space needed after the `;`
  assert.deepEqual(at("mute /Lead; mo").toolLabels, ["mode"]);
  assert.deepEqual(at("mute /Lead; mo").replace, { from: 12, to: 14 });
  // arguments and usage follow the part
  const second = at("mute /Lead; tag ");
  assert.equal(second.usage, "<tag>");
  assert.deepEqual(second.setLabels, ["fx", "drums", "bass line"]);
  assert.deepEqual(second.replace, { from: 16, to: 16 });
  // a caret in the first part of a longer line
  const first = at("mute ki|ck; tag fx");
  assert.deepEqual(first.setLabels.slice(0, 2), ["/Drums/Kick#1", "/Drums/Kick#2"]);
  assert.deepEqual(first.replace, { from: 5, to: 9 });
  // right before the `;` still belongs to the first part, right after it to the next
  assert.equal(at("mute /Lead|; tag fx").replace.from, 5);
  assert.equal(at("mute /Lead;| tag fx").replace.from, 11);
  // a `;` in quotes is text, not a separator
  assert.deepEqual(at('mute "a;b" ').toolLabels.includes("note"), false);
  assert.equal(at('mute "/2-808 Co').replace.from, 5);
  // `rest` words of an earlier part do not leak into the next part's value
  assert.deepEqual(at("goto snare; goto dr").replace, { from: 17, to: 19 });
});

test("chainSegments is exposed through complete.ts for the page (CmdComplete.chainSegments)", async () => {
  const mod = await import("./complete.js");
  assert.deepEqual(mod.chainSegments("a; b"), [{ start: 0, end: 1 }, { start: 2, end: 4 }]);
});

test("a bare word that is exactly a tag name shows the silent expansion first (mute drums runs as mute #drums)", () => {
  const d: CompletionData = { ...data, paths: paths.filter((p) => !/drums/i.test(p.path)) }; // no object is named "drums" here
  const r = at("mute drums", d);
  assert.deepEqual(r.setLabels, ["#drums"]);
  assert.equal(r.items.find((i) => i.kind === "tag")!.insert, "#drums");
  assert.equal(r.items.find((i) => i.kind === "tag")!.description, "drums runs as #drums (2 tracks)");
  assert.deepEqual(r.replace, { from: 5, to: 10 });
  assert.deepEqual(at("mute DRUMS", d).setLabels, ["#drums"]); // case ignored, as the resolver does
  assert.deepEqual(at("mute fx", d).setLabels[0], "#fx");
  assert.equal(at("mute fx", d).items.find((i) => i.kind === "tag")!.description, "fx runs as #fx (1 track)");
});

test("no silent expansion when the word names an object or is only part of a tag, nor for a path, a rest or a text argument; other kinds do not count as naming it", () => {
  // "drums" names the track /Drums in the shared fixture: it stays an ordinary target
  assert.equal(at("mute drums").items.some((i) => i.kind === "tag"), false);
  const d: CompletionData = { ...data, paths: [] };
  assert.equal(at("mute dru", d).items.some((i) => i.kind === "tag"), false); // not exactly a tag name yet
  assert.equal(at('mute "drums"', d).items.some((i) => i.kind === "tag"), true); // a quoted word is the same text to the resolver, so it expands too
  assert.equal(at("goto drums", d).items.some((i) => i.kind === "tag"), false); // rest: no tag fan-out
  assert.equal(at("mute #drums", d).items.filter((i) => i.kind === "tag").length, 1); // the normal #tag row, not a second one
  assert.equal(at("mute /drums", d).items.some((i) => i.kind === "tag"), false); // a path is a path
  assert.equal(at("mute bass line", d).items.some((i) => i.kind === "tag"), false);
  // a text argument is not a target
  assert.equal(at("tag drums", d).items.some((i) => i.kind === "tag"), false);
  // kinds: an object of ANOTHER kind does not count as naming it
  const onlyDevice: CompletionData = { ...data, paths: [{ path: "/Lead/fx", name: "fx", kind: "device" }] };
  assert.equal(at("tag x fx", onlyDevice).items.some((i) => i.kind === "tag" && i.label === "#fx"), true); // `tag` targets tracks only
});

test("silent tag row follows the resolver's rule exactly (tagTargetOf): the own-name rule and the tag's kinds", () => {
  const base: CompletionData = {
    ...data,
    paths: [
      { path: "/Bass", name: "Bass", kind: "track" },
      { path: "/Bass/Drum Rack", name: "Drum Rack", kind: "device" },
      { path: "/Bass/Drum Rack/Kick", name: "Kick", kind: "chain" },
    ],
    tags: [{ name: "rack", count: 2, kinds: ["track"] }],
  };
  // The word only occurs in a PARENT's name and in a device the argument cannot take: the resolver finds no object, so `rack` expands.
  const r = at("ranked rack", base);
  assert.equal(r.setLabels[0], "#rack"); // first, before the path rows that merely contain the word
  assert.equal(r.items.find((i) => i.kind === "tag")!.description, "rack runs as #rack (2 tracks)");
  // …but a chain whose OWN name holds the word is an object: an ordinary target, no expansion
  const named: CompletionData = { ...base, paths: [...base.paths, { path: "/Bass/Rack Kick", name: "Rack Kick", kind: "chain" }] };
  assert.equal(at("ranked rack", named).items.some((i) => i.kind === "tag"), false);
  // A tag that sits on no object of the argument's kinds is not expanded (the resolver does not)
  const onDevice: CompletionData = { ...base, tags: [{ name: "x", count: 1, kinds: ["device"] }] };
  assert.equal(at("ranked x", onDevice).items.some((i) => i.kind === "tag"), false);
  const onChain: CompletionData = { ...base, tags: [{ name: "x", count: 1, kinds: ["device", "chain"] }] };
  assert.equal(at("ranked x", onChain).items.some((i) => i.kind === "tag" && i.label === "#x"), true); // a chain is one of the kinds
  // Older data without kinds: any kind is assumed
  const old: CompletionData = { ...base, tags: [{ name: "x", count: 1 }] };
  assert.equal(at("ranked x", old).items.some((i) => i.label === "#x"), true);
});

test("a leading backslash (the no-default escape) completes like the bare word (0019 §7)", () => {
  assert.deepEqual(at("\\mute").labels, at("mute").labels);
  assert.equal(at("\\mu").labels[0], "mute");
  assert.deepEqual(at("\\mu").replace, { from: 0, to: 3 });
  // Arguments and options after `\cmd ` complete as after `cmd `.
  assert.deepEqual(at("\\mute -").labels, at("mute -").labels);
  assert.deepEqual(at("\\mute ").labels, at("mute ").labels);
  // A lone backslash lists the commands.
  assert.deepEqual(at("\\").labels, at("").labels);
});

// ── help for the palette footer (plan 0019 §4) ──
const helpTree: CommandNode<any, any>[] = [
  {
    name: "tag",
    summary: "tag tracks",
    options: [
      { name: "edit", short: "e", takesValue: true, valueDefault: "#", valueLabels: ["tag|#"], summary: "edit a tag's tracks on the board" },
      { name: "all", summary: "include everything" },
    ],
    args: [{ name: "tag", kind: "text", summary: "a tag name, or # to pick one" }, { name: "targets", kind: "path", required: false, variadic: true }],
    run,
  },
  {
    name: "vol",
    summary: "set a volume",
    options: [{ name: "to", takesValue: true, number: {}, summary: "target level" }],
    args: [{ name: "value", kind: "number", summary: "the level" }],
    run,
  },
  { name: "pakabl", summary: "extensions", children: [{ name: "install", summary: "install one", args: [{ name: "id", kind: "text", summary: "the extension id" }], run }] },
];
const helpData: CompletionData = { tree: completionTree(helpTree), completions: {}, paths: [], tags: [] };
const helpAt = (line: string) => complete(line, line.length, helpData).help;

test("help: the command and its first argument", () => {
  assert.deepEqual(helpAt("tag "), { command: "tag", summary: "tag tracks", focus: { label: "<tag>", text: "a tag name, or # to pick one" } });
});

test("help: a subcommand's argument names the full path", () => {
  assert.deepEqual(helpAt("pakabl install "), { command: "pakabl install", summary: "install one", focus: { label: "<id>", text: "the extension id" } });
});

test("help: an option waiting for its value", () => {
  assert.deepEqual(helpAt("vol --to "), { command: "vol", summary: "set a volume", focus: { label: "--to <n>", text: "target level" } });
});

test("help: while typing a dash the first option row is the focus", () => {
  assert.deepEqual(helpAt("tag -"), { command: "tag", summary: "tag tracks", focus: { label: "--edit", text: "-e  <tag|#>  edit a tag's tracks on the board" } });
});

test("help: an empty line, an unknown command and the command word itself give none", () => {
  assert.equal(helpAt(""), undefined);
  assert.equal(helpAt("nope "), undefined);
  assert.equal(helpAt("ta"), undefined);
});

test("help: inside a chain and after a pipe it follows the part at the caret", () => {
  assert.equal(helpAt("vol 1; tag ")?.command, "tag");
  assert.equal(helpAt("map x | vol ")?.command, "vol");
});

test("help: a group alone names the group without a focus", () => {
  assert.deepEqual(helpAt("pakabl "), { command: "pakabl", summary: "extensions" });
});

test("help: a leaf's `config` subcommand names the settings, not the command's arguments", () => {
  const tree: CommandNode<any, any>[] = [{ name: "mute", summary: "mute tracks", args: [{ name: "target", kind: "path", summary: "what to mute" }], run, config: { name: "config", summary: "open the settings of mute", run } as never }];
  const d: CompletionData = { tree: completionTree(tree), completions: {}, paths: [], tags: [] };
  assert.deepEqual(complete("mute config ", 12, d).help, { command: "mute config", summary: "open the settings of mute" });
  assert.equal(complete("mute ", 5, d).help?.focus?.label, "<target>");
});
