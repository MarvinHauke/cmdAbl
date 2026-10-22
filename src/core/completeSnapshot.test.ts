import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompletionData, MAX_CANDIDATES, MAX_PATHS, MAX_TAGS, normalizeCandidates, pathRows, tagRows, withBudget } from "./completeSnapshot.js";
import { complete } from "./complete.js";
import { CommandRegistry } from "./commandRegistry.js";
import { completerKeys, unknownCompleterKeys, type CommandNode } from "./commandTree.js";
import type { ObjectNode } from "../ableton/objectTree.js";
import type { Completer } from "./complete.js";

const run = () => undefined;
const node = (path: string, kind: ObjectNode["kind"], tags?: string[]): ObjectNode => ({
  handleId: path,
  route: [],
  kind,
  scope: "regular",
  name: path.split("/").pop()!.replace(/#\d+$/, ""),
  path,
  children: [],
  ...(tags ? { tags } : {}),
});

const roots: CommandNode<any, any>[] = [
  { name: "tag", summary: "tag", options: [{ name: "rename", takesValue: true, values: 2, complete: "tags", summary: "rename" }], args: [{ name: "t", kind: "text", complete: "words" }], run },
  { name: "pakabl", summary: "x", children: [{ name: "install", summary: "i", args: [{ name: "id", kind: "enum", complete: "ids" }], run }] },
];

test("the snapshot holds the slim tree, completer rows by key, paths and tags", async () => {
  const nodes = [node("/Kick", "track", ["drums"]), node("/Kick/Eq", "device"), node("/Lead", "track", ["drums", "fx"])];
  const data = await buildCompletionData({
    roots,
    completers: new Map<string, Completer>([
      ["tags", () => ["a", { label: "b", description: "d" }]],
      ["words", async () => ["w"]],
      ["ids", () => []],
    ]),
    nodes: () => nodes,
  });
  assert.deepEqual(data.completions, { tags: [{ label: "a" }, { label: "b", description: "d" }], words: [{ label: "w" }], ids: [] });
  assert.deepEqual(data.paths.map((p) => [p.path, p.kind]), [["/Kick", "track"], ["/Kick/Eq", "device"], ["/Lead", "track"]]);
  assert.deepEqual(data.tags, [{ name: "drums", count: 2 }, { name: "fx", count: 1 }]);
  assert.equal(data.tree.length, 2);
  assert.equal(JSON.parse(JSON.stringify(data)).tree[0].name, "tag"); // plain JSON
  assert.equal("run" in data.tree[0]!, false);
  // and complete() works on exactly this data
  assert.deepEqual(complete("tag --rename ", 13, data).items.map((i) => i.label), ["a", "b"]);
  assert.deepEqual(complete("pakabl install ", 15, data).items.filter((i) => i.zone === "set"), []);
});

test("duplicate names insert the unique path", () => {
  const rows = pathRows([node("/Drums", "track"), node("/Drums/Kick", "device"), node("/Drums/Kick#2", "device")]);
  assert.deepEqual(rows.map((r) => r.path), ["/Drums", "/Drums/Kick#1", "/Drums/Kick#2"]);
});

test("a completer that throws, rejects or is too slow gives no rows and a debug line; the others still answer", async () => {
  const debug: string[] = [];
  const data = await buildCompletionData({
    roots,
    completers: new Map<string, () => never[] | Promise<string[]>>([
      ["tags", () => { throw new Error("boom"); }],
      ["words", () => new Promise((resolve) => setTimeout(() => resolve(["late"]), 200))],
      ["ids", () => Promise.resolve(["x"])],
    ]),
    nodes: () => [],
    completerBudgetMs: 20,
    debug: (line) => debug.push(line),
  });
  assert.deepEqual(data.completions.tags, []);
  assert.deepEqual(data.completions.words, []);
  assert.deepEqual(data.completions.ids, [{ label: "x" }]);
  assert.equal(debug.filter((l) => /gave no rows/.test(l)).length, 2);
  assert.ok(debug.some((l) => /^completion timing: cache refresh \d+ ms, completers \d+ ms more, reading the Set \d+ ms, rows \d+ ms$/.test(l)));
  assert.match(debug.join("\n"), /completer "tags" gave no rows: boom/);
  assert.match(debug.join("\n"), /completer "words" gave no rows: took over 20 ms/);
  const rejecting = await buildCompletionData({ roots, completers: new Map([["tags", () => Promise.reject(new Error("no"))]]), nodes: () => [], debug: () => {} });
  assert.deepEqual(rejecting.completions.tags, []);
});

test("a key nobody registered gives an empty list; a slow cache refresh does not block", async () => {
  const debug: string[] = [];
  const started = Date.now();
  const data = await buildCompletionData({
    roots,
    completers: new Map(),
    nodes: () => [node("/A", "track")],
    refresh: () => new Promise(() => {}), // never answers
    refreshBudgetMs: 20,
    debug: (line) => debug.push(line),
  });
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(data.completions, { tags: [], words: [], ids: [] });
  assert.equal(data.paths.length, 1);
  assert.match(debug.join("\n"), /cache refresh gave up/);
});

test("reading the Set fails: an empty snapshot, not an error", async () => {
  const data = await buildCompletionData({ roots, completers: new Map(), nodes: () => { throw new Error("no song"); }, debug: () => {} });
  assert.deepEqual(data.paths, []);
  assert.deepEqual(data.tags, []);
});

test("refresh runs before the Set is read", async () => {
  const order: string[] = [];
  await buildCompletionData({
    roots,
    completers: new Map(),
    refresh: async () => void order.push("refresh"),
    nodes: () => (order.push("nodes"), []),
  });
  assert.deepEqual(order, ["refresh", "nodes"]);
});

test("caps: paths keep tracks first, then chains, then devices, in tree order; tags keep the most used", () => {
  const nodes: ObjectNode[] = [];
  for (let i = 0; i < 10; i++) {
    nodes.push(node(`/T${i}`, "track"), node(`/T${i}/Dev`, "device"), node(`/T${i}/Pad`, "chain"));
  }
  const rows = pathRows(nodes, 15);
  assert.equal(rows.length, 15);
  assert.equal(rows.filter((r) => r.kind === "track").length, 10);
  assert.equal(rows.filter((r) => r.kind === "chain").length, 5);
  assert.equal(rows.filter((r) => r.kind === "device").length, 0);
  assert.deepEqual(rows.map((r) => r.path).slice(0, 3), ["/T0", "/T0/Pad", "/T1"]); // tree order kept
  const tagged = Array.from({ length: 5 }, (_, i) => node(`/X${i}`, "track", [`t${i}`, ...(i === 4 ? ["t0"] : [])]));
  assert.deepEqual(tagRows(tagged, 2).map((t) => t.name), ["t0", "t1"]); // t0 has 2 tracks; ties by name; result sorted by name
  assert.ok(MAX_PATHS >= 500 && MAX_TAGS >= 100);
});

test("normalizeCandidates drops junk and caps", () => {
  assert.deepEqual(normalizeCandidates("nope"), []);
  assert.deepEqual(normalizeCandidates(["a", "", 1, null, { label: "b", insert: "b" }, { label: "c", insert: "C", description: "" }]), [{ label: "a" }, { label: "b" }, { label: "c", insert: "C" }]);
  assert.equal(normalizeCandidates(Array.from({ length: MAX_CANDIDATES + 50 }, (_, i) => `r${i}`)).length, MAX_CANDIDATES);
  assert.equal(normalizeCandidates(["x".repeat(1000)])[0]!.label.length, 200);
});

test("withBudget answers the work, or the fallback on a throw or a timeout, and clears its timer", async () => {
  assert.equal(await withBudget(() => 5, 50, 0), 5);
  assert.equal(await withBudget(() => { throw new Error("x"); }, 50, 0), 0);
  assert.equal(await withBudget(() => new Promise<number>(() => {}), 10, -1), -1);
});

test("completer keys: collected from args and options; unknown ones are reported with their place", () => {
  assert.deepEqual(completerKeys(roots), ["words", "tags", "ids"]); // arguments before options per node
  assert.deepEqual(unknownCompleterKeys(roots, ["tags"]), [
    'tag <t>: unknown completer "words"',
    'pakabl install <id>: unknown completer "ids"',
  ]);
  assert.deepEqual(unknownCompleterKeys(roots, ["tags", "words", "ids"]), []);
});

test("the registry keeps the first completer of a key and reports unknown keys", () => {
  const registry = new CommandRegistry();
  const first = () => ["1"];
  registry.completer("tags", first);
  registry.completer("tags", () => ["2"]);
  registry.completer("", first);
  assert.equal(registry.completers().get("tags"), first);
  assert.deepEqual([...registry.completers().keys()], ["tags"]);
  registry.add({ ...roots[0]!, run: () => undefined } as never);
  assert.deepEqual(registry.unknownCompleters(), ['tag <t>: unknown completer "words"']);
});

test("payload for a Set with 300 tracks stays small enough for the dialog URL", async () => {
  const nodes: ObjectNode[] = [];
  for (let i = 0; i < 300; i++) {
    const tags = i % 3 === 0 ? ["drums", `part-${i % 20}`] : i % 5 === 0 ? ["fx"] : undefined;
    nodes.push(node(`/${i + 1}-Track name with some length ${i}`, "track", tags));
    nodes.push(node(`/${i + 1}-Track name with some length ${i}/Utility`, "device"), node(`/${i + 1}-Track name with some length ${i}/EQ Eight`, "device"));
  }
  const started = Date.now();
  const data = await buildCompletionData({ roots, completers: new Map([["tags", () => Array.from({ length: 40 }, (_, i) => `tag-${i}`)]]), nodes: () => nodes });
  const ms = Date.now() - started;
  const json = JSON.stringify(data);
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(json)}`;
  console.log(`# completion snapshot, 300 tracks / ${nodes.length} objects: ${data.paths.length} paths, ${data.tags.length} tags, ${json.length} bytes JSON, ${url.length} bytes as URL text, built in ${ms} ms`);
  assert.equal(data.paths.length, 900);
  assert.ok(json.length < 200_000);
  assert.ok(ms < 1000);
});

test("the fast path gives the same unique paths as uniquePath for every node, also with repeated parents", async () => {
  const { uniquePath } = await import("../ableton/resolvePath.js");
  const nodes = [
    node("/Drums", "track"),
    node("/Drums#2", "track"),
    node("/Drums/Kick", "device"),
    node("/Drums#2/Kick", "device"),
    node("/Drums#2/Kick#2", "device"),
    node("/Lead", "track"),
    node("/lead", "track"),
    node("/Lead/EQ", "device"),
  ];
  assert.deepEqual(pathRows(nodes).map((r) => r.path), nodes.map((n) => uniquePath(nodes, n)));
});

test("validateTree: an option's complete key needs a value option and no fixed choices or number", async () => {
  const { validateTree } = await import("./commandTree.js");
  const leaf = (options: NonNullable<CommandNode["options"]>): CommandNode[] => [{ name: "x", summary: "s", options, run }];
  assert.deepEqual(validateTree(leaf([{ name: "a", takesValue: true, complete: "k", summary: "s" }])), []);
  assert.match(validateTree(leaf([{ name: "a", complete: "k", summary: "s" }])).join("\n"), /complete but takes no value/);
  assert.match(validateTree(leaf([{ name: "a", takesValue: true, choices: ["1"], complete: "k", summary: "s" }])).join("\n"), /complete together with choices or number/);
  assert.match(validateTree(leaf([{ name: "a", takesValue: true, number: {}, complete: "k", summary: "s" }])).join("\n"), /complete together with choices or number/);
  assert.match(validateTree(leaf([{ name: "a", takesValue: true, complete: " ", summary: "s" }])).join("\n"), /empty complete key/);
});

test("per-completer timing is logged, and a synchronous completer over its budget is a warning", async () => {
  const debug: string[] = [];
  const warn: string[] = [];
  const spin = (ms: number): string[] => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* a blocking body */
    }
    return ["x"];
  };
  const data = await buildCompletionData({
    roots,
    completers: new Map<string, Completer>([["tags", () => spin(30)], ["words", () => ["w"]], ["ids", async () => ["i"]]]),
    nodes: () => [],
    completerBudgetMs: 10,
    debug: (l) => debug.push(l),
    warn: (l) => warn.push(l),
  });
  assert.deepEqual(data.completions.tags, [{ label: "x" }]); // sync work finished before the timer could fire: its rows stay
  assert.equal(warn.length, 1);
  assert.match(warn[0]!, /^completer "tags" blocked for \d+ ms \(over its 10 ms budget\)/);
  const line = debug.find((l) => l.startsWith("completion completers: "))!;
  assert.match(line, /tags \d+ ms \(\d+ ms synchronous\)/);
  assert.match(line, /words \d+ ms/);
  assert.match(line, /ids \d+ ms/);
});
