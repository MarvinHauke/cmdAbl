// JSON for inlining into a <script> block of an HTML page. `<` is escaped so a
// value like "</script>" or "<!--" cannot end the script or start an HTML
// comment; the line separators are escaped for older script parsers. The
// output is still valid JSON. No imports, so any module may use it.

export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
