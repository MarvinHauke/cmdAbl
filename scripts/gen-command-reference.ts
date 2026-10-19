// Writes docs/reference/commands.md from the command tree.
//
//   npm run docs:reference              write the page
//   npm run docs:reference -- --check   fail if the committed page differs (CI)
//
// The generator needs the bundled modules, which import the dialog pages as
// text (the esbuild `text` loader the extension build uses); so it bundles
// scripts/command-reference-main.ts the same way and runs the result.

import * as esbuild from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "cmdabl-reference-"));
const out = path.join(dir, "main.mjs");
try {
  await esbuild.build({
    entryPoints: [path.resolve(import.meta.dirname, "command-reference-main.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    loader: { ".html": "text" },
    logLevel: "warning",
    // The pages' placeholders stay as they are: only the command tree is read.
  });
  await import(pathToFileURL(out).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
