import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// Import boundaries (docs/feature-plans/0004, 0005). The test reads the import
// statements of every source file and fails with file, import and rule when a
// boundary is crossed. A known violation is listed in EXCEPTIONS with the
// reason, so the debt is visible; an exception that no longer applies fails
// the test too, so the list cannot rot.
//
// Rules (paths relative to the repository root, without extension):
//   1. src/modules/<name>/…  does not import another module's folder,
//      src/httpTrigger, src/extension or a dialog page under ui/ — except its
//      own page, ui/<name>-*.html (a module's dialog is part of the module; the
//      platform's pages — interface, pick, feedback — stay off limits).
//      Helpers directly under src/modules/ are shared; they follow the same
//      rules except that src/modules/index.ts (the manifest) may import every
//      module folder.
//   2. src/core/…            does not import src/modules/, src/httpTrigger
//      or src/extension.
//   3. src/ableton/…         does not import src/modules/, src/core/ui or
//      src/extension.
//   4. Only src/core/ui.ts opens dialogs (`showModalDialog`); a module hands
//      its page to the UI surfaces instead.

// The repository root: two levels up from this file's folder is wrong for a
// file directly in src/, so use the location of src/ itself.
const ROOT = typeof __dirname === "string" ? path.resolve(__dirname, "..") : process.cwd();
const PLATFORM_PAGES = new Set(["interface", "pick", "feedback"]);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Violation {
  file: string;
  specifier: string;
  target: string;
  rule: string;
}

interface Exception {
  file: string;
  target: string;
  why: string;
}

const EXCEPTIONS: Exception[] = [];

/** Every relative import of one file: `from "…"`, bare `import "…"`, dynamic `import("…")`. */
export function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  const patterns = [
    /^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/gm,
    /^[ \t]*import\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers.filter((s) => s.startsWith("."));
}

/** The repo-relative path an import points at, without .js/.ts. */
export function resolveImport(file: string, specifier: string): string {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return target.replace(/\.(js|ts)$/, "");
}

/** The rule a single import breaks, or null. */
export function brokenRule(file: string, target: string): string | null {
  const inModules = /^src\/modules\/(?:([^/]+)\/)?/.exec(file);
  if (inModules) {
    const name = inModules[1]; // undefined for the shared helpers directly under src/modules/
    const other = /^src\/modules\/([^/]+)\//.exec(target);
    if (other && other[1] !== name && file !== "src/modules/index.ts") {
      return `1: ${name ? "a module" : "a shared helper"} does not import a module folder (${other[1]})`;
    }
    if (target === "src/httpTrigger" || target === "src/extension") return `1: modules do not import ${target}`;
    if (target.startsWith("ui/")) {
      const own = name !== undefined && !PLATFORM_PAGES.has(name)
        && new RegExp(`^ui/${escapeRegExp(name)}(-[^/]*)?\\.html$`).test(target);
      if (!own) return `1: a module does not import the platform's dialog pages${name ? ` (only ui/${name}-*.html)` : ""}`;
    }
  }
  if (file.startsWith("src/core/")) {
    if (target.startsWith("src/modules/")) return "2: core does not import modules";
    if (target === "src/httpTrigger" || target === "src/extension") return `2: core does not import ${target}`;
  }
  if (file.startsWith("src/ableton/")) {
    if (target.startsWith("src/modules/")) return "3: ableton does not import modules";
    if (target === "src/core/ui" || target === "src/extension") return `3: ableton does not import ${target}`;
  }
  return null;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

function violations(): Violation[] {
  const found: Violation[] = [];
  for (const file of sourceFiles("src")) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const specifier of importSpecifiers(source)) {
      const target = resolveImport(file, specifier);
      const rule = brokenRule(file, target);
      if (rule) found.push({ file, specifier, target, rule });
    }
  }
  return found;
}

test("architecture: no import crosses a boundary (apart from the listed exceptions)", () => {
  const excepted = (v: Violation) => EXCEPTIONS.some((e) => e.file === v.file && e.target === v.target);
  const unexpected = violations().filter((v) => !excepted(v));
  assert.deepEqual(
    unexpected.map((v) => `${v.file} imports "${v.specifier}" (${v.target}) — rule ${v.rule}`),
    [],
    "boundary crossed; fix the import or add a reasoned entry to EXCEPTIONS",
  );
});

test("architecture: every listed exception is still needed", () => {
  const found = violations();
  const stale = EXCEPTIONS.filter((e) => !found.some((v) => v.file === e.file && v.target === e.target));
  assert.deepEqual(
    stale.map((e) => `${e.file} -> ${e.target}`),
    [],
    "this exception no longer applies; remove it from EXCEPTIONS",
  );
});

// Rule 4 is about behaviour, not imports: a module that calls the SDK's modal
// dialog itself bypasses the dialog queue and the UI surfaces.
const DIALOG_EXCEPTIONS: { file: string; why: string }[] = [
  {
    file: "src/modules/pakabl/index.ts",
    why: "`pakabl list` opens its page directly until a page surface exists on Ui/ModuleApi (outside the dialog queue)",
  },
];

function filesCallingShowModalDialog(): string[] {
  return sourceFiles("src").filter(
    (file) =>
      !file.endsWith(".test.ts") &&
      file !== "src/core/ui.ts" &&
      /\.showModalDialog\b/.test(fs.readFileSync(path.join(ROOT, file), "utf8")),
  );
}

test("architecture: only core/ui.ts opens dialogs (apart from the listed exceptions)", () => {
  const callers = filesCallingShowModalDialog();
  const listed = new Set(DIALOG_EXCEPTIONS.map((e) => e.file));
  assert.deepEqual(callers.filter((f) => !listed.has(f)), [], "opens a dialog itself; use the UI surfaces");
  assert.deepEqual(
    [...listed].filter((f) => !callers.includes(f)),
    [],
    "this dialog exception no longer applies; remove it from DIALOG_EXCEPTIONS",
  );
});

test("architecture: the checker sees the imports and flags what it should", () => {
  assert.ok(sourceFiles("src").length > 30);
  const specifiers = importSpecifiers(
    [
      `import { a } from "./a.js";`,
      `import type { B } from "../b.js";`,
      `export { c } from "./c.js";`,
      `import "./side.js";`,
      `const m = await import("./lazy.js");`,
      `// import { x } from "./commented.js";`,
      `import fs from "node:fs";`,
    ].join("\n"),
  );
  assert.deepEqual(specifiers.sort(), ["../b.js", "./a.js", "./c.js", "./lazy.js", "./side.js"]);
  assert.equal(resolveImport("src/modules/goto/index.ts", "../mute/index.js"), "src/modules/mute/index");

  assert.match(brokenRule("src/modules/goto/index.ts", "src/modules/mute/index") ?? "", /^1:/);
  assert.match(brokenRule("src/modules/goto/index.ts", "src/extension") ?? "", /^1:/);
  assert.match(brokenRule("src/modules/goto/index.ts", "ui/pick.html") ?? "", /^1:/);
  assert.equal(brokenRule("src/modules/pakabl/index.ts", "ui/pakabl-list.html"), null);
  assert.equal(brokenRule("src/modules/mute/index.ts", "src/modules/trackSetCommand"), null);
  assert.match(brokenRule("src/modules/trackSetCommand.ts", "src/extension") ?? "", /^1:/);
  assert.match(brokenRule("src/modules/trackSetCommand.ts", "src/modules/goto/index") ?? "", /^1:/);
  assert.equal(brokenRule("src/modules/index.ts", "src/modules/goto/index"), null);
  assert.match(brokenRule("src/modules/pick/index.ts", "ui/pick.html") ?? "", /^1:/); // a module named like a platform page
  assert.match(brokenRule("src/modules/pa/index.ts", "ui/pakabl-list.html") ?? "", /^1:/); // prefix is not a match
  assert.match(brokenRule("src/core/run.ts", "src/modules/find/matches") ?? "", /^2:/);
  assert.match(brokenRule("src/core/run.ts", "src/extension") ?? "", /^2:/);
  assert.match(brokenRule("src/ableton/select.ts", "src/extension") ?? "", /^3:/);
  assert.match(brokenRule("src/core/run.ts", "src/httpTrigger") ?? "", /^2:/);
  assert.match(brokenRule("src/ableton/select.ts", "src/core/ui") ?? "", /^3:/);
  assert.match(brokenRule("src/ableton/select.ts", "src/modules/types") ?? "", /^3:/);
  assert.equal(brokenRule("src/ableton/select.ts", "src/types"), null);
});
