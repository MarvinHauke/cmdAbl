import { test } from "node:test";
import assert from "node:assert/strict";
import { DB_AT_STEP } from "./mixTable.js";
import { dbToValue, MAX_DB, valueToDb } from "./mixValue.js";

test("the table is Live's curve: 1001 points, -inf first, monotonic, 0 dB at 0.85, +6 at 1.0", () => {
  assert.equal(DB_AT_STEP.length, 1001);
  assert.equal(DB_AT_STEP[0], -Infinity);
  for (let i = 1; i < DB_AT_STEP.length; i++) assert.ok(DB_AT_STEP[i]! >= DB_AT_STEP[i - 1]!, `step ${i}`);
  assert.equal(DB_AT_STEP[850], 0);
  assert.equal(DB_AT_STEP[1000], 6);
});

test("0 dB is about 0.850; the linear part runs 40 dB per unit", () => {
  assert.ok(Math.abs(dbToValue(0).value - 0.85) < 0.0006);
  assert.ok(Math.abs(valueToDb(0.85)) < 0.05);
  assert.ok(Math.abs(valueToDb(0.6) - -10) < 0.1);
  assert.ok(Math.abs(valueToDb(0.9) - 2) < 0.1);
});

test("-inf maps to 0 and back", () => {
  assert.deepEqual(dbToValue(-Infinity), { value: 0, limit: "-inf" });
  assert.equal(valueToDb(0), -Infinity);
  assert.equal(valueToDb(-1), -Infinity);
  assert.equal(valueToDb(NaN), -Infinity);
});

test("above +6 dB the value is 1.0 and the limit is max; exactly +6 is no limit hit", () => {
  assert.deepEqual(dbToValue(7), { value: 1, limit: "max" });
  assert.deepEqual(dbToValue(Infinity), { value: 1, limit: "max" });
  assert.deepEqual(dbToValue(MAX_DB), { value: 1 });
  assert.equal(valueToDb(1.5), 6);
});

test("below the lowest step the fader goes to -inf and says so", () => {
  assert.deepEqual(dbToValue(-80), { value: 0, limit: "-inf" });
  assert.equal(dbToValue(-60).limit, undefined);
});

test("round trip within 0.1 dB from -60 to +6, and the value is monotonic in dB", () => {
  let last = -1;
  for (let db = -60; db <= 6; db += 0.1) {
    const { value, limit } = dbToValue(db);
    assert.equal(limit, undefined);
    assert.ok(value >= last, `monotonic at ${db}`);
    last = value;
    assert.ok(Math.abs(valueToDb(value) - db) <= 0.1, `${db} -> ${value} -> ${valueToDb(value)}`);
  }
});

test("value -> dB -> value stays within one step where the curve is steep", () => {
  for (const v of [0.01, 0.1, 0.25, 0.4, 0.5, 0.85, 0.95]) {
    assert.ok(Math.abs(dbToValue(valueToDb(v)).value - v) <= 0.003, String(v));
  }
});
