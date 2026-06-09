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

// Shared CSS injected into every HTML template (same pattern as the Fuse bundle above).
const sharedCss = fs.readFileSync("ui/shared.css", "utf8");

// esbuild inlines all ui/*.html files as strings (the `text` loader). Hook the
// load so build-time placeholders are replaced before bundling:
//   interface.html  — Fuse.js bundle + shared CSS
//   all other .html — shared CSS only
const htmlInlinePlugin: esbuild.Plugin = {
  name: "html-inline",
  setup(build) {
    build.onLoad({ filter: /\.html$/ }, (args) => {
      let html = fs.readFileSync(args.path, "utf8");
      if (args.path.endsWith("interface.html")) {
        html = html.replace("/*FUSE_PLACEHOLDER*/", () => fuseSource);
      }
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
