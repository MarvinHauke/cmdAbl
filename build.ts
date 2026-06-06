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

// esbuild inlines interface.html as a string (the `text` loader). Hook the
// load so the Fuse bundle is injected into the page's placeholder first.
const htmlInlinePlugin: esbuild.Plugin = {
  name: "html-inline",
  setup(build) {
    build.onLoad({ filter: /interface\.html$/ }, (args) => {
      const html = fs
        .readFileSync(args.path, "utf8")
        .replace("/*FUSE_PLACEHOLDER*/", () => fuseSource);
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
