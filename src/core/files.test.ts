import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createModuleFiles, validFileName, MAX_FILE_BYTES } from "./files.js";

function setup(module = "note") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cmdabl-files-"));
  const warnings: string[] = [];
  let name = module;
  const files = createModuleFiles({ base, module: () => name, warn: (t) => void warnings.push(t) });
  return { base, warnings, files, rename: (n: string) => (name = n), done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("file names: plain names only", () => {
  for (const ok of ["abc.md", "a b.txt", "x", "set-1_2.md", "a".repeat(100)]) assert.equal(validFileName(ok), true, ok);
  for (const bad of ["", ".hidden", "../x", "a/b", "a\\b", "a..b", "..", "a".repeat(101), "a\0b"]) assert.equal(validFileName(bad), false, JSON.stringify(bad));
  assert.equal(validFileName(5 as never), false);
});

test("write then read round-trips UTF-8 inside modules/<module>/, creating the folder", async () => {
  const s = setup();
  try {
    const text = "# Titel\n- [ ] Äpfel ☃ 🎹\n";
    assert.equal(await s.files.write("a.md", text), true);
    assert.equal(fs.readFileSync(path.join(s.base, "modules", "note", "a.md"), "utf8"), text);
    assert.equal(await s.files.read("a.md"), text);
    assert.equal(await s.files.write("a.md", "new"), true); // replaces
    assert.equal(await s.files.read("a.md"), "new");
    assert.deepEqual(fs.readdirSync(path.join(s.base, "modules", "note")), ["a.md"]); // no temp file left
    assert.deepEqual(s.warnings, []);
  } finally {
    s.done();
  }
});

test("a missing file reads null without a warning", async () => {
  const s = setup();
  try {
    assert.equal(await s.files.read("nope.md"), null);
    assert.deepEqual(s.warnings, []);
  } finally {
    s.done();
  }
});

test("refused names: null/false and a warning; nothing is written outside the folder", async () => {
  const s = setup();
  try {
    for (const bad of ["../escape.md", "sub/x.md", ".hidden", "", "a\\b"]) {
      assert.equal(await s.files.write(bad, "x"), false, bad);
      assert.equal(await s.files.read(bad), null, bad);
    }
    assert.equal(s.warnings.length, 10);
    assert.ok(!fs.existsSync(path.join(s.base, "escape.md")));
    assert.ok(!fs.existsSync(path.join(s.base, "modules")));
  } finally {
    s.done();
  }
});

test("modules are separate; a module name that is not a plain name gets nothing", async () => {
  const s = setup("note");
  try {
    await s.files.write("a.md", "note's");
    s.rename("other");
    assert.equal(await s.files.read("a.md"), null); // not the note module's file
    s.rename("../evil");
    assert.equal(await s.files.write("a.md", "x"), false);
    assert.equal(await s.files.read("a.md"), null);
    assert.ok(!fs.existsSync(path.join(s.base, "evil")));
  } finally {
    s.done();
  }
});

test("too much text is refused; a failing disk answers false and leaves no temp file", async () => {
  const s = setup();
  try {
    assert.equal(await s.files.write("big.md", "x".repeat(MAX_FILE_BYTES + 1)), false);
    // a directory where the file should go: the rename fails
    fs.mkdirSync(path.join(s.base, "modules", "note", "taken"), { recursive: true });
    assert.equal(await s.files.write("taken", "x"), false);
    assert.deepEqual(fs.readdirSync(path.join(s.base, "modules", "note")), ["taken"]);
    assert.ok(s.warnings.every((w) => !w.includes("xxxx")), "no content in warnings");
  } finally {
    s.done();
  }
});

test("nothing throws when the base folder is unusable", async () => {
  const warnings: string[] = [];
  const files = createModuleFiles({ base: "/dev/null/x", module: () => "note", warn: (t) => void warnings.push(t) });
  assert.equal(await files.write("a.md", "x"), false);
  assert.equal(await files.read("a.md"), null);
  assert.ok(warnings.length >= 1);
});
