import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

// The palette webview is a standalone data: URL with no module loader, so
// Fuse.js can't be `import`ed there. Bundle it to a browser IIFE that exposes
// a `Fuse` global, then inline that into the HTML at build time.
const fuseBundle = await esbuild.build({
  stdin: {
    contents: `import Fuse from "fuse.js"; window.Fuse = Fuse;`,
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  write: false,
});
const fuseSource = fuseBundle.outputFiles[0].text;

// The one name matcher (src/core/match.ts), bundled the same way: the pages
// get it as the `CmdMatch` global (matches, rank, filterRanked). It contains
// Fuse.js, so a page using CmdMatch needs no separate Fuse placeholder.
const matchBundle = await esbuild.build({
  stdin: {
    contents: `import * as m from "./src/core/match.ts"; window.CmdMatch = m;`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  write: false,
});
const matchSource = matchBundle.outputFiles[0].text;
// Both bundles are inlined into a <script> block: a literal end tag would cut it.
for (const [name, text] of [["fuse", fuseSource], ["match", matchSource]] as const) {
  if (/<\/script/i.test(text)) throw new Error(`the ${name} bundle contains "</script": cannot be inlined into a page`);
}

// Shared CSS injected into every HTML template (same pattern as the Fuse bundle above).
const sharedCss = fs.readFileSync("ui/shared.css", "utf8");

// esbuild inlines all ui/*.html files as strings (the `text` loader). Hook the
// load so build-time placeholders are replaced before bundling:
//   interface.html  — Fuse.js bundle (until it moves to CmdMatch) + shared CSS
//   every .html     — shared CSS, and the matcher where /*MATCH_PLACEHOLDER*/ stands
const htmlInlinePlugin: esbuild.Plugin = {
  name: "html-inline",
  setup(build) {
    build.onLoad({ filter: /\.html$/ }, (args) => {
      let html = fs.readFileSync(args.path, "utf8");
      if (args.path.endsWith("interface.html")) {
        html = html.replace("/*FUSE_PLACEHOLDER*/", () => fuseSource);
      }
      html = html.replace("/*MATCH_PLACEHOLDER*/", () => matchSource);
      html = html.replace("/*SHARED_CSS_PLACEHOLDER*/", () => sharedCss);
      return { contents: html, loader: "text" };
    });
  },
};

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  plugins: [htmlInlinePlugin],
});
