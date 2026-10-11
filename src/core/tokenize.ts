// Shell-like tokenizer shared by the host parser and (later) the palette's
// completion engine — plain TypeScript with no imports so it can be bundled
// into both. See docs/feature-plans/0005-command-tree-and-module-authoring.md.
//
// Rules: whitespace separates tokens; "double" and 'single' quotes group text
// (needed because track names contain spaces); a backslash escapes the next
// character outside single quotes. Positions are kept so completion can tell
// which token the cursor is in.

export interface Token {
  value: string;
  /** Offset of the token's first character in the input (including an opening quote). */
  start: number;
  /** Offset just past the token's last character (including a closing quote). */
  end: number;
  /** True if any part of the token was quoted (whether it is an option is decided by its first raw character, see parse.ts). */
  quoted: boolean;
}

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: string; tokens: Token[] };

export function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    while (i < n && /\s/.test(input[i]!)) i++;
    if (i >= n) break;

    const start = i;
    let value = "";
    let quoted = false;
    let quote: '"' | "'" | null = null;

    while (i < n) {
      const ch = input[i]!;
      if (quote) {
        if (ch === quote) {
          quote = null;
        } else if (ch === "\\" && quote === '"' && i + 1 < n) {
          value += input[++i]!;
        } else {
          value += ch;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        quoted = true;
      } else if (ch === "\\" && i + 1 < n) {
        value += input[++i]!;
      } else if (/\s/.test(ch)) {
        break;
      } else {
        value += ch;
      }
      i++;
    }

    tokens.push({ value, start, end: i, quoted });
    if (quote) return { ok: false, error: `unterminated ${quote} quote`, tokens };
  }

  return { ok: true, tokens };
}

/** Quote a value for insertion into a command line if it needs it. */
export function quoteIfNeeded(value: string): string {
  // A leading dash is quoted too, or the word would re-parse as an option.
  if (value !== "" && !value.startsWith("-") && !/[\s"'\\]/.test(value)) return value;
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}
