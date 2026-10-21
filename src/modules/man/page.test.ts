import { test } from "node:test";
import assert from "node:assert/strict";
import { helpText, type CommandNode } from "../../core/commandTree.js";
import { allPaths, anchorOf, closeMatches, findNode, manPage, webUrl } from "./page.js";

const tree: CommandNode[] = [
  {
    name: "history",
    summary: "the command history",
    children: [
      { name: "clear", summary: "empty it", aliases: ["wipe"], destructive: true, examples: [{ line: "history clear", note: "ask first" }], options: [{ name: "force", short: "f", summary: "do not ask" }] },
      { name: "restore", summary: "bring entries back" },
    ],
  },
  { name: "tag", summary: "tag tracks", requires: ["bridge"], args: [{ name: "target", kind: "text", summary: "a track" }] },
  { name: "cmdabl", summary: "cmdAbl itself", children: [{ name: "setup", summary: "install the script" }] },
];

test("findNode walks names and aliases, ignoring case", () => {
  assert.deepEqual(findNode(tree, ["history", "clear"])?.path, ["history", "clear"]);
  assert.deepEqual(findNode(tree, ["HISTORY", "wipe"])?.path, ["history", "clear"]);
  assert.equal(findNode(tree, ["history", "nope"]), undefined);
  assert.equal(findNode(tree, []), undefined);
});

test("anchor and url follow the heading of the generated reference", () => {
  assert.equal(anchorOf(["history", "clear"]), "history-clear");
  assert.equal(webUrl(["tag"]), "https://marvinhauke.github.io/cmdAbl/reference/commands/#tag");
});

test("a page holds the help text, the notes and the web line", () => {
  const found = findNode(tree, ["history", "clear"])!;
  const page = manPage(helpText(found.node as never, found.path), found.node, found.path);
  assert.match(page, /^empty it/);
  assert.match(page, /usage: history clear/);
  assert.match(page, /--force/);
  assert.match(page, /note: aliases: wipe/);
  assert.match(page, /note: removes or irreversibly/);
  assert.match(page, /web: .*#history-clear$/);
  const tagPage = manPage(helpText(tree[1]!, ["tag"]), tree[1]!, ["tag"]);
  assert.match(tagPage, /note: needs the Remote Script/);
  assert.match(tagPage, /<target>/);
});

test("a group page lists its subcommands", () => {
  assert.match(manPage(helpText(tree[0]!, ["history"]), tree[0]!, ["history"]), /commands:\n {2}clear/);
});

test("close matches: prefix, substring and typos, best first", () => {
  assert.deepEqual(closeMatches(tree, ["hist"]).slice(0, 1), ["history"]);
  assert.ok(closeMatches(tree, ["histroy"]).includes("history"));
  assert.ok(closeMatches(tree, ["clear"]).includes("history clear"));
  assert.deepEqual(closeMatches(tree, ["zzzzzz"]), []);
  assert.ok(closeMatches(tree, ["history", "clr"]).includes("history clear"));
});

test("allPaths lists every command and subcommand", () => {
  assert.equal(allPaths(tree).length, 6);
});
