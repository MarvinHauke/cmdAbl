import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { DOCS_BASE_URL, KEYBOARD_DOCS_URL, REMOTE_SCRIPT_DOCS_URL } from "./setup.js";

// `cmdabl setup` ends each step with a link to a heading of docs/getting-started.md.
// If a heading is renamed the link silently lands at the top of the page: this
// keeps them in sync. Slugs as MkDocs makes them: lower-case, punctuation
// (backticks included) dropped, spaces → "-".

const ROOT = typeof __dirname === "string" ? path.resolve(__dirname, "../..") : process.cwd();

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

test("setup's docs links point at headings that exist in getting-started.md", () => {
  const text = fs.readFileSync(path.join(ROOT, "docs/getting-started.md"), "utf8");
  const slugs = text
    .split("\n")
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => slugify(line.replace(/^#+\s+/, "")));
  for (const url of [KEYBOARD_DOCS_URL, REMOTE_SCRIPT_DOCS_URL]) {
    assert.ok(url.startsWith(`${DOCS_BASE_URL}getting-started/#`), url);
    const anchor = url.slice(url.indexOf("#") + 1);
    assert.ok(slugs.includes(anchor), `no heading in docs/getting-started.md has the anchor #${anchor} (headings: ${slugs.join(", ")})`);
  }
});

test("slugify matches MkDocs for the headings in use", () => {
  assert.equal(slugify("2. Run `cmdabl setup`"), "2-run-cmdabl-setup");
  assert.equal(slugify("3. Turn on the Remote Script in Live"), "3-turn-on-the-remote-script-in-live");
});
