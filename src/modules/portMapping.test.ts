import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeApi } from "./testPorts.js";
import { PORT_MAPPING, lomUrl } from "./portMapping.js";

// The port methods of the ModuleApi, found on the fake. A sound source: the fake is typed as ModuleApi,
// so a port added to the interface and forgotten in createFakeApi fails the type check first.
function portMethods(): string[] {
  const { api, bridge } = createFakeApi();
  const found: string[] = [];
  for (const [name, value] of Object.entries(api)) {
    if (name === "bridge") {
      for (const [method, member] of Object.entries(bridge)) {
        if (typeof member === "function") found.push(`bridge.${method}`);
      }
    } else if (typeof value === "function") {
      found.push(name);
    } else if (value && typeof value === "object") {
      for (const [method, member] of Object.entries(value)) {
        if (typeof member === "function") found.push(`${name}.${method}`);
      }
    }
  }
  return found.sort();
}

test("every port method of ModuleApi has an entry in the mapping table", () => {
  const entries = new Set(PORT_MAPPING.map((e) => e.port));
  const missing = portMethods().filter((method) => !entries.has(method));
  assert.deepEqual(missing, [], "add the port method to PORT_MAPPING (src/modules/portMapping.ts)");
});

test("the table has no entries for methods that do not exist, and no duplicates", () => {
  const methods = new Set(portMethods());
  const stale = PORT_MAPPING.map((e) => e.port).filter((p) => !p.includes("(") && !methods.has(p));
  assert.deepEqual(stale, []);
  const ports = PORT_MAPPING.map((e) => e.port);
  assert.equal(new Set(ports).size, ports.length);
});

test("track properties are listed as TrackHandle members", () => {
  for (const key of ["mute", "solo", "arm"]) {
    assert.ok(PORT_MAPPING.some((e) => e.port === `tracks.track().${key}`), key);
  }
});

test("lomUrl points at the class page", () => {
  assert.equal(lomUrl("Track.mute"), "https://docs.cycling74.com/apiref/lom/track/");
  assert.equal(lomUrl("DrumPad.mute"), "https://docs.cycling74.com/apiref/lom/drumpad/");
});

test("fake api.pick records a state option", async () => {
  const { api, pickStates } = createFakeApi({ nodes: [] });
  await api.pick("t", [], true, { state: { label: "tagged fx", values: [true], change: "toggle" } });
  assert.deepEqual(pickStates, [{ label: "tagged fx", values: [true], change: "toggle" }]);
});

test("fake tracks.volume and setVolume: 0.85 by default, clamped writes, only track nodes, transaction passes a promise on", async () => {
  const fake = createFakeApi({ nodes: [] });
  const api = fake.api;
  const track = { handleId: "t1", kind: "track" } as never;
  const device = { handleId: "d1", kind: "device" } as never;
  assert.equal(await api.tracks.volume(track), 0.85);
  assert.equal(await api.tracks.setVolume(track, 3), true);
  assert.equal(await api.tracks.volume(track), 1);
  assert.equal(await api.tracks.volume(device), null);
  assert.equal(await api.tracks.setVolume(device, 0.5), false);
  const done = api.tracks.transaction(() => api.tracks.setVolume(track, 0.5));
  assert.ok(done instanceof Promise);
  await done;
  assert.equal(fake.volumes.get("t1"), 0.5);
});
