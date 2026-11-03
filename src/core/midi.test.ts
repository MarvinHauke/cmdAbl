import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOperator,
  controlMatches,
  controlOf,
  formatControl,
  isBlocked,
  initialState,
  listenControl,
  parseControl,
  substituteValue,
  validateBinding,
  type MidiMessage,
  type OperatorName,
  type OperatorState,
} from "./midi.js";

const cc = (value: number, number = 51, channel = 1): MidiMessage => ({ type: "cc", channel, number, value });
const on = (number = 36, velocity = 100, channel = 1): MidiMessage => ({ type: "note_on", channel, number, value: velocity });
const off = (number = 36, channel = 1): MidiMessage => ({ type: "note_off", channel, number, value: 0 });

/** Feed the messages through the operator the way the engine does (down always kept; on only when it fires). */
function run(operator: OperatorName, messages: MidiMessage[], threshold?: number): Array<number | "-" | "fire"> {
  const state: OperatorState = initialState();
  return messages.map((m) => {
    const r = applyOperator(operator, m, state, { threshold });
    state.down = r.next.down;
    if (r.fire) state.on = r.next.on;
    return r.fire ? (r.value ?? "fire") : "-";
  });
}

test("parseControl and formatControl: CC<n>, N<n>, PB, /ch<1-16>, case ignored", () => {
  assert.deepEqual(parseControl("CC37"), { kind: "cc", number: 37 });
  assert.deepEqual(parseControl("cc37/ch2"), { kind: "cc", number: 37, channel: 2 });
  assert.deepEqual(parseControl("N36"), { kind: "note", number: 36 });
  assert.deepEqual(parseControl("n127/ch16"), { kind: "note", number: 127, channel: 16 });
  assert.deepEqual(parseControl("PB"), { kind: "pb" });
  assert.deepEqual(parseControl("pb/ch3"), { kind: "pb", channel: 3 });
  for (const bad of ["", "CC", "N", "CC128", "CC37/ch0", "CC37/ch17", "PB5", "X12", "CC-1", "CC37 /ch2", "CC37/ch", "36"]) assert.equal(parseControl(bad), null, bad);
  for (const text of ["CC37", "CC37/ch2", "N36", "N0/ch16", "PB", "PB/ch1"]) assert.equal(formatControl(parseControl(text)!), text);
});

test("controlMatches: the kind, the number and the channel (omni without /ch)", () => {
  assert.equal(controlMatches(parseControl("CC51")!, cc(10)), true);
  assert.equal(controlMatches(parseControl("CC51")!, cc(10, 51, 7)), true); // omni
  assert.equal(controlMatches(parseControl("CC51/ch2")!, cc(10)), false);
  assert.equal(controlMatches(parseControl("CC51/ch2")!, cc(10, 51, 2)), true);
  assert.equal(controlMatches(parseControl("CC52")!, cc(10)), false);
  assert.equal(controlMatches(parseControl("N36")!, on()), true);
  assert.equal(controlMatches(parseControl("N36")!, off()), true);
  assert.equal(controlMatches(parseControl("N36")!, cc(10, 36)), false);
  assert.equal(controlMatches(parseControl("PB")!, { type: "pb", channel: 1, number: 0, value: 8192 }), true);
  assert.equal(controlMatches(parseControl("PB")!, cc(1)), false);
  assert.equal(formatControl(controlOf(on(40, 100, 3))), "N40/ch3");
  assert.equal(formatControl(controlOf(cc(1, 7, 2))), "CC7/ch2");
  assert.deepEqual(listenControl(parseControl("N36/ch2")!), { type: "note", channel: 2, number: 36 });
  assert.deepEqual(listenControl(parseControl("PB")!), { type: "pb" });
});

test("press on the UC4's buttons (10 on press, 0 on release): fires once per press, not on 0 and not on repeats", () => {
  assert.deepEqual(run("press", [cc(10), cc(0), cc(10), cc(0)]), ["fire", "-", "fire", "-"]);
  assert.deepEqual(run("press", [cc(10), cc(20), cc(127), cc(0)]), ["fire", "-", "-", "-"]); // 10 then 20 is no second press
  assert.deepEqual(run("press", [cc(0), cc(0)]), ["-", "-"]); // a 0 after 0 is nothing
});

test("release fires when the CC falls to 0 after a press", () => {
  assert.deepEqual(run("release", [cc(10), cc(0), cc(0), cc(10), cc(0)]), ["-", "fire", "-", "-", "fire"]);
  assert.deepEqual(run("release", [cc(0)]), ["-"]); // never pressed
});

test("hold hands 1 on press and 0 on release", () => {
  assert.deepEqual(run("hold", [cc(10), cc(0), cc(127), cc(0)]), [1, 0, 1, 0]);
  assert.deepEqual(run("hold", [cc(10), cc(30), cc(0)]), [1, "-", 0]);
});

test("toggle hands 1, 0, 1 … on each press and nothing on release", () => {
  assert.deepEqual(run("toggle", [cc(10), cc(0), cc(10), cc(0), cc(10), cc(0)]), [1, "-", 0, "-", 1, "-"]);
});

test("notes: every note-on is a press and every note-off a release, whatever the velocity", () => {
  assert.deepEqual(run("press", [on(36, 1), off(), on(36, 127), on(36, 5), off()]), ["fire", "-", "fire", "fire", "-"]);
  assert.deepEqual(run("release", [on(), off(), on(), off()]), ["-", "fire", "-", "fire"]);
  assert.deepEqual(run("hold", [on(), off(), on(), off()]), [1, 0, 1, 0]);
  assert.deepEqual(run("toggle", [on(), off(), on(), off(), on()]), [1, "-", 0, "-", 1]);
});

test("the press threshold is a parameter: above it is down, at or below it is up", () => {
  assert.deepEqual(run("press", [cc(10), cc(64), cc(0)], 63), ["-", "fire", "-"]);
  assert.deepEqual(run("release", [cc(64), cc(63), cc(10)], 63), ["-", "fire", "-"]);
  assert.deepEqual(run("hold", [cc(100), cc(64), cc(63)], 63), [1, "-", 0]);
  assert.deepEqual(run("press", [cc(1)]), ["fire"]); // default 0: any value above 0
});

test("the operator is pure: the state it is given is not changed, and a dropped toggle can be retried", () => {
  const state = initialState();
  const first = applyOperator("toggle", cc(10), state);
  assert.deepEqual(state, { down: false, on: false });
  assert.deepEqual(first, { fire: true, value: 1, next: { down: true, on: true } });
  // the caller dropped the run: on stays false, the edge (down) is kept — the next press hands 1 again
  const dropped = { down: true, on: false };
  const release = applyOperator("toggle", cc(0), dropped);
  assert.deepEqual(release, { fire: false, next: { down: false, on: false } });
  assert.equal(applyOperator("toggle", cc(10), release.next).value, 1);
});

test("validateBinding and substituteValue: {} needs an operator with a value", () => {
  assert.equal(validateBinding("press", "mute #drums --set {}"), "press gives no value; use hold or toggle");
  assert.equal(validateBinding("release", "vol {}"), "release gives no value; use hold or toggle");
  assert.equal(validateBinding("hold", "mute #drums --set {}"), null);
  assert.equal(validateBinding("toggle", "solo #lead --set {}"), null);
  assert.equal(validateBinding("press", "mute #drums --set 0"), null);
  assert.equal(substituteValue("mute #a --set {}; solo #b --set {}", 1), "mute #a --set 1; solo #b --set 1");
  assert.equal(substituteValue("next", undefined), "next");
  assert.equal(substituteValue("a {} b", 0), "a 0 b");
});

test("isBlocked: a control without a channel is blocked by any /chN entry, one with a channel only by that entry; null is not blocked", () => {
  const blocked = ["CC51/ch1", "N60/ch2", "PB/ch3"];
  const is = (text: string, list: string[] | null = blocked) => isBlocked(parseControl(text)!, list);
  assert.equal(is("CC51"), true);
  assert.equal(is("CC51/ch1"), true);
  assert.equal(is("CC51/ch2"), false);
  assert.equal(is("CC52"), false);
  assert.equal(is("N60"), true);
  assert.equal(is("N60/ch2"), true);
  assert.equal(is("N60/ch1"), false);
  assert.equal(is("PB"), true);
  assert.equal(is("PB/ch3"), true);
  assert.equal(is("PB/ch1"), false);
  assert.equal(is("CC51", []), false);
  assert.equal(is("CC51", null), false); // unknown: not claimed
  assert.equal(is("CC51", ["garbage", "CC5/ch1"]), false); // CC5 is not CC51
});
