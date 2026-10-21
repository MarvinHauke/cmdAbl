// JSON for inlining into a <script> block of an HTML page. `<` is escaped so a
// value like "</script>" or "<!--" cannot end the script or start an HTML
// comment; the line separators are escaped for older script parsers. The
// output is still valid JSON. No imports, so any module may use it.

export function inlineJson(value: unknown): string {
  return (JSON.stringify(value) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Fill a page's `/*KEY_PLACEHOLDER*\/null` slots in ONE pass over the template, so a value that
 * happens to contain a placeholder text (a track named like one) is never substituted itself.
 * A key without a value is left as it is.
 */
export function fillTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\/\*([A-Z_]+)_PLACEHOLDER\*\/null/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? inlineJson(values[key]) : whole,
  );
}
