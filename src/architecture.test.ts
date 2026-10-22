import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { builtinModules } from "node:module";

// Import boundaries (docs/feature-plans/0004, 0005). The test reads the import
// statements of every source file and fails with file, import and rule when a
// boundary is crossed. A known violation is listed in EXCEPTIONS with the
// reason, so the debt is visible; an exception that no longer applies fails
// the test too, so the list cannot rot.
//
// Rules (paths relative to the repository root, without extension):
//   1. src/modules/<name>/…  does not import another module's folder,
//      src/httpTrigger, src/extension or a dialog page under ui/ — except its
//      own pages, ui/modules/<name>/*.html (a module's dialog is part of the
//      module; every other page under ui/ — the platform's surfaces — stays off limits).
//      Helpers directly under src/modules/ are shared; they follow the same
//      rules except that src/modules/index.ts (the manifest) may import every
//      module folder.
//   2. src/core/…            does not import src/modules/, src/httpTrigger
//      or src/extension.
//   3. src/ableton/…         does not import src/modules/, src/extension or
//      anything in src/core/ but the shared types (src/core/types) and the logger (src/core/log).
//   5. src/modules/…         reaches Live through the ModuleApi ports: it does
//      not import src/ableton/bridge, src/ableton/trackLookup,
//      src/ableton/tagCache or the SDK
//      (`@ableton-extensions/*`), so a command's `run` is testable with fakes.
//   6. src/modules/…         does not reach out through Node itself: of the Node
//      built-ins a module may import `path`, `url` (pure) and, in tests,
//      `test` / `assert`; every other one — child_process, fs, net, dgram,
//      http, tls, dns, module, … — breaks the rule (bare `fs` counts like
//      `node:fs`). What needs a process, a socket or a file belongs to the
//      platform or the Live layer; a module that still must is a listed
//      exception below. This is not a sandbox: globals need no import
//      (`fetch`, `process.env`).
//   4. Only src/core/ui.ts opens dialogs (`showModalDialog`); a module hands
//      its page to the UI surfaces instead.

// The repository root: two levels up from this file's folder is wrong for a
// file directly in src/, so use the location of src/ itself.
const ROOT = typeof __dirname === "string" ? path.resolve(__dirname, "..") : process.cwd();
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

const EXCEPTIONS: Exception[] = [
  {
    file: "src/modules/pakabl/platform.ts",
    target: "node:child_process",
    why: "pakabl downloads, unpacks, deletes and reads files by shelling out (curl, unzip, rm, cat; PowerShell on Windows); no port offers file or network access yet",
  },
];

/** The only Node built-ins a module may import (rule 6). */
const NODE_ALLOWED = new Set(["node:path", "node:url", "node:test", "node:assert", "node:assert/strict"]);

const BUILTINS = new Set(builtinModules);

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
  // Relative imports, the SDK (rule 5) and Node built-ins (rule 6); other packages are not boundaries.
  return specifiers.filter(
    (s) => s.startsWith(".") || s.startsWith("@ableton-extensions/") || s.startsWith("node:") || BUILTINS.has(s),
  );
}

/** The repo-relative path an import points at, without .js/.ts. */
export function resolveImport(file: string, specifier: string): string {
  if (!specifier.startsWith(".")) return BUILTINS.has(specifier) && !specifier.startsWith("node:") ? `node:${specifier}` : specifier; // a package; `fs` is `node:fs`
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
    if (target === "src/ableton/bridge" || target === "src/ableton/trackLookup" || target === "src/ableton/tagCache") {
      return `5: modules reach Live through the ModuleApi ports, not ${target}`;
    }
    if (target.startsWith("node:") && !NODE_ALLOWED.has(target)) return `6: modules do not reach out through Node (${target}); ask the platform for a port`;
    if (target.startsWith("@ableton-extensions/")) return `5: modules reach Live through the ModuleApi ports, not the SDK (${target})`;
    if (target.startsWith("ui/")) {
      const own = name !== undefined && new RegExp(`^ui/modules/${escapeRegExp(name)}/[^/]+\\.html$`).test(target);
      if (!own) return `1: a module does not import the platform's dialog pages${name ? ` (only ui/modules/${name}/*.html)` : ""}`;
    }
  }
  if (file.startsWith("src/core/")) {
    if (target.startsWith("src/modules/")) return "2: core does not import modules";
    if (target === "src/httpTrigger" || target === "src/extension") return `2: core does not import ${target}`;
  }
  if (file.startsWith("src/ableton/")) {
    if (target.startsWith("src/modules/")) return "3: ableton does not import modules";
    if (target === "src/extension") return `3: ableton does not import ${target}`;
    if (target.startsWith("src/core/") && target !== "src/core/types" && target !== "src/core/log") {
      return `3: ableton knows the platform only through its shared types and the logger, not ${target}`;
    }
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
const DIALOG_EXCEPTIONS: { file: string; why: string }[] = [];

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

// Rule 7 (plan 0011): every log line goes through src/core/log.ts, the one file that touches the console.
const CONSOLE_EXCEPTIONS: { file: string; why: string }[] = [];

function filesUsingConsole(): string[] {
  return sourceFiles("src").filter(
    (file) =>
      !file.endsWith(".test.ts") &&
      file !== "src/core/log.ts" &&
      /\bconsole\.\w+/.test(fs.readFileSync(path.join(ROOT, file), "utf8")),
  );
}

test("architecture: no console.* outside src/core/log.ts (apart from the listed exceptions)", () => {
  const users = filesUsingConsole();
  const listed = new Set(CONSOLE_EXCEPTIONS.map((e) => e.file));
  assert.deepEqual(users.filter((f) => !listed.has(f)), [], "use the logger from src/core/log.ts (api.logger in a module)");
  assert.deepEqual([...listed].filter((f) => !users.includes(f)), [], "this console exception no longer applies; remove it from CONSOLE_EXCEPTIONS");
});

// Live's Extension Host lacks some globals (the startup log "host globals" says which: URL,
// URLSearchParams, structuredClone, TextEncoder are undefined there). Node's test runner has them,
// so a unit test cannot catch their use: this one reads the source. tools/ runs in plain Node.
const MISSING_GLOBALS = /\b(?:new\s+URL\s*\(|\bURL\.\w+\s*\(|new\s+URLSearchParams\b|structuredClone\s*\(|new\s+TextEncoder\b|new\s+TextDecoder\b)/;

test("architecture: src/ does not use globals the Extension Host lacks (URL, URLSearchParams, structuredClone, TextEncoder)", () => {
  const users = sourceFiles("src").filter((file) => {
    if (file.endsWith(".test.ts")) return false;
    const code = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    return MISSING_GLOBALS.test(code);
  });
  assert.deepEqual(users, [], "parse by hand (see splitUrl in src/devRoutes.ts) or use a Node module");
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
      `import { spawnSync } from "child_process";`,
      `import type { ExtensionContext } from "@ableton-extensions/sdk";`,
    ].join("\n"),
  );
  assert.deepEqual(specifiers.sort(), ["../b.js", "./a.js", "./c.js", "./lazy.js", "./side.js", "@ableton-extensions/sdk", "child_process", "node:fs"]);
  assert.equal(resolveImport("src/modules/goto/index.ts", "../mute/index.js"), "src/modules/mute/index");

  assert.match(brokenRule("src/modules/goto/index.ts", "src/modules/mute/index") ?? "", /^1:/);
  assert.match(brokenRule("src/modules/goto/index.ts", "src/extension") ?? "", /^1:/);
  assert.match(brokenRule("src/modules/goto/index.ts", "ui/pick.html") ?? "", /^1:/);
  assert.equal(brokenRule("src/modules/pakabl/index.ts", "ui/modules/pakabl/list.html"), null);
  assert.equal(brokenRule("src/modules/mute/index.ts", "src/modules/trackSetCommand"), null);
  assert.match(brokenRule("src/modules/trackSetCommand.ts", "src/extension") ?? "", /^1:/);
  assert.match(brokenRule("src/modules/trackSetCommand.ts", "src/modules/goto/index") ?? "", /^1:/);
  assert.equal(brokenRule("src/modules/index.ts", "src/modules/goto/index"), null);
  assert.match(brokenRule("src/modules/pick/index.ts", "ui/pick.html") ?? "", /^1:/); // a module named like a platform page
  assert.match(brokenRule("src/modules/pa/index.ts", "ui/modules/pakabl/list.html") ?? "", /^1:/); // a prefix of the folder name is not a match
  assert.match(brokenRule("src/modules/pakabl/index.ts", "ui/modules/pakabl/sub/x.html") ?? "", /^1:/); // only directly in the module's folder
  assert.match(brokenRule("src/modules/pakabl/index.ts", "ui/pick.html") ?? "", /^1:/); // never a platform page
  assert.match(brokenRule("src/modules/goto/index.ts", "node:child_process") ?? "", /^6:/);
  assert.match(brokenRule("src/modules/goto/index.ts", "node:dgram") ?? "", /^6:/);
  assert.match(brokenRule("src/modules/goto/index.ts", "node:tls") ?? "", /^6:/); // anything not allowed
  assert.equal(resolveImport("src/modules/goto/index.ts", "child_process"), "node:child_process"); // bare spelling
  assert.match(brokenRule("src/modules/goto/index.ts", resolveImport("src/modules/goto/index.ts", "fs")) ?? "", /^6:/);
  assert.equal(brokenRule("src/modules/goto/run.test.ts", "node:test"), null);
  assert.equal(brokenRule("src/modules/goto/run.test.ts", "node:assert/strict"), null);
  assert.equal(brokenRule("src/modules/pakabl/guards.ts", "node:path"), null);
  assert.equal(brokenRule("src/core/openUrl.ts", "node:child_process"), null); // core and ableton are not under rule 6
  assert.match(brokenRule("src/modules/goto/index.ts", "src/ableton/bridge") ?? "", /^5:/);
  assert.match(brokenRule("src/modules/trackSetCommand.ts", "src/ableton/trackLookup") ?? "", /^5:/);
  assert.match(brokenRule("src/modules/tag/index.ts", "src/ableton/tagCache") ?? "", /^5:/);
  assert.match(brokenRule("src/modules/goto/snapshot.ts", "@ableton-extensions/sdk") ?? "", /^5:/);
  assert.equal(brokenRule("src/modules/goto/index.ts", "src/ableton/bridgeClient"), null); // the Bridge type is fine
  assert.equal(brokenRule("src/extension.ts", "src/ableton/bridge"), null);
  assert.match(brokenRule("src/core/run.ts", "src/modules/find/matches") ?? "", /^2:/);
  assert.match(brokenRule("src/core/run.ts", "src/extension") ?? "", /^2:/);
  assert.match(brokenRule("src/ableton/select.ts", "src/extension") ?? "", /^3:/);
  assert.match(brokenRule("src/core/run.ts", "src/httpTrigger") ?? "", /^2:/);
  assert.match(brokenRule("src/ableton/select.ts", "src/core/ui") ?? "", /^3:/);
  assert.match(brokenRule("src/ableton/select.ts", "src/modules/types") ?? "", /^3:/);
  assert.equal(brokenRule("src/ableton/select.ts", "src/core/types"), null);
  assert.equal(brokenRule("src/ableton/tagCache.ts", "src/core/log"), null); // the logger is allowed
  assert.match(brokenRule("src/ableton/tagCache.ts", "src/core/run") ?? "", /^3:/);
  assert.match(brokenRule("src/ableton/select.ts", "src/core/run") ?? "", /^3:/); // ableton knows core only through its shared types
  assert.match(brokenRule("src/ableton/select.ts", "src/core/setup") ?? "", /^3:/);
});
