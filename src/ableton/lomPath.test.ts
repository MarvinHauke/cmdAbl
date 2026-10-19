import { test } from "node:test";
import assert from "node:assert/strict";
import { lomPage, lomPath, lomReferenceUrl } from "./lomPath.js";

test("track paths by scope", () => {
  assert.equal(lomPath({ scope: "regular", route: [4] }), "live_set tracks 4");
  assert.equal(lomPath({ scope: "return", route: [1] }), "live_set return_tracks 1");
  assert.equal(lomPath({ scope: "master", route: [0] }), "live_set master_track");
});

test("device and chain paths, nested as the route allows", () => {
  assert.equal(lomPath({ scope: "regular", route: [2, 0] }), "live_set tracks 2 devices 0");
  assert.equal(lomPath({ scope: "regular", route: [2, 0, 2] }), "live_set tracks 2 devices 0 chains 2");
  assert.equal(lomPath({ scope: "return", route: [0, 1, 3, 0] }), "live_set return_tracks 0 devices 1 chains 3 devices 0");
  assert.equal(lomPath({ scope: "master", route: [0, 1] }), "live_set master_track devices 1");
});

test("a bad route never throws", () => {
  assert.equal(lomPath({ scope: "regular", route: [] }), "live_set");
  assert.equal(lomPath({ scope: "regular", route: undefined as unknown as number[] }), "live_set");
});

test("page slugs", () => {
  assert.equal(lomPage({ kind: "track" }), "track");
  assert.equal(lomPage({ kind: "device", children: [] }), "device");
  assert.equal(lomPage({ kind: "device", children: [{}] }), "rackdevice");
  assert.equal(lomPage({ kind: "chain" }), "chain");
  assert.equal(lomReferenceUrl("rackdevice"), "https://docs.cycling74.com/apiref/lom/rackdevice/");
});
