import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, indexRelation } from "./version.js";

test("equal, newer and older versions", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.0.1"), 1);
  assert.equal(compareVersions("0.0.1", "0.1.0"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1); // numbers, not text
  assert.equal(compareVersions("v1.2.3", "1.2.3+build5"), 0);
});

test("prerelease rules of semver", () => {
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.11"), -1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-beta.11"), 1);
});

test("text that is no version compares to nothing", () => {
  assert.equal(compareVersions("1.0", "1.0.0"), null);
  assert.equal(compareVersions("latest", "1.0.0"), null);
});

test("the index relation names what an update would be", () => {
  assert.equal(indexRelation("0.0.1", "0.1.0"), "newer");
  assert.equal(indexRelation("0.1.0", "0.1.0"), "same");
  assert.equal(indexRelation("0.1.0", "0.0.1"), "older");
  assert.equal(indexRelation("0.1.0", "0.2.0-beta"), "newer");
  assert.equal(indexRelation("1.0.0", "1.0.0-rc.1"), "older");
  assert.equal(indexRelation("nightly", "0.1.0"), "unknown");
  assert.equal(indexRelation("nightly", "nightly"), "same");
});

test("the installed relation is seen from the installed version", async () => {
  const { installedRelation } = await import("./version.js");
  assert.equal(installedRelation("0.1.0", "0.0.1"), "newer"); // installed is newer than the index
  assert.equal(installedRelation("0.0.1", "0.1.0"), "older");
  assert.equal(installedRelation("0.1.0", "0.1.0"), "same");
  assert.equal(installedRelation("nightly", "0.1.0"), "unknown");
});
