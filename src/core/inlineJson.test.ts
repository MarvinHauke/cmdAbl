import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineJson } from "./inlineJson.js";

test("inlineJson: </script> and <!-- cannot appear in the output and round-trip", () => {
  const value = { a: "x</script><script>alert(1)</script>", b: ["<!--", "<", "\u2028 \u2029"], n: 1 };
  const out = inlineJson(value);
  assert.ok(!out.includes("<"));
  assert.ok(!out.includes("</script"));
  assert.ok(!out.includes("<!--"));
  assert.ok(!/[\u2028\u2029]/.test(out));
  assert.deepEqual(JSON.parse(out), value);
});

test("inlineJson: plain values are unchanged JSON", () => {
  assert.equal(inlineJson({ a: [1, "b", null] }), '{"a":[1,"b",null]}');
});
