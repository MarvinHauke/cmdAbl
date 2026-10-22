import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");
// `--outfile=<path>` builds elsewhere than manifest.entry (the test that inspects the production bundle).
const outfile = process.argv.find((a) => a.startsWith("--outfile="))?.slice("--outfile=".length) ?? manifest.entry;

// The dialog pages are standalone data: URLs with no module loader, so nothing
// can be `import`ed there.
//
// The one name matcher (src/core/match.ts) and the argument completion (src/core/complete.ts),
// bundled together to one browser IIFE that exposes the `CmdMatch` global (matches, ranker,
// filterer, …) and the `CmdComplete` global (complete, locate, …), inlined into the pages at build
// time. It contains Fuse.js.
const matchBundle = await esbuild.build({
  stdin: {
    contents: `import * as m from "./src/core/match.ts"; import * as c from "./src/core/complete.ts"; window.CmdMatch = m; window.CmdComplete = c;`,
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
// The bundle is inlined into a <script> block: a literal end tag would cut it.
if (/<\/script/i.test(matchSource)) throw new Error('the matcher bundle contains "</script": cannot be inlined into a page');

// Shared CSS injected into every HTML template (same pattern as the matcher bundle above).
const sharedCss = fs.readFileSync("ui/shared.css", "utf8");

// esbuild inlines all ui/*.html files as strings (the `text` loader). Hook the
// load so build-time placeholders are replaced before bundling:
//   every .html     — shared CSS, and the matcher where /*MATCH_PLACEHOLDER*/ stands
const htmlInlinePlugin: esbuild.Plugin = {
  name: "html-inline",
  setup(build) {
    build.onLoad({ filter: /\.html$/ }, (args) => {
      let html = fs.readFileSync(args.path, "utf8");
      html = html.replace("/*MATCH_PLACEHOLDER*/", () => matchSource);
      html = html.replace("/*SHARED_CSS_PLACEHOLDER*/", () => sharedCss);
      return { contents: html, loader: "text" };
    });
  },
};

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  plugins: [htmlInlinePlugin],
  // The development-only routes (plan 0016: POST /run, GET /log) exist only without --production;
  // the code behind the constant is removed from a production bundle.
  define: { CMDABL_DEV_ROUTES: String(!production) },
});
