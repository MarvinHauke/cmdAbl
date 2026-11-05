import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineJson, fillTemplate } from "./inlineJson.js";

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

test("inlineJson: undefined (which JSON.stringify cannot encode) becomes null", () => {
  assert.equal(inlineJson(undefined), "null");
});

test("fillTemplate: one pass, so a value containing a placeholder is not substituted", () => {
  const tpl = "const A = /*MESSAGE_PLACEHOLDER*/null; const B = /*LINK_PLACEHOLDER*/null; const C = /*OTHER_PLACEHOLDER*/null;";
  const out = fillTemplate(tpl, { MESSAGE: "x /*LINK_PLACEHOLDER*/null y", LINK: { label: "l" } });
  assert.equal(out, 'const A = "x /*LINK_PLACEHOLDER*/null y"; const B = {"label":"l"}; const C = /*OTHER_PLACEHOLDER*/null;');
});
