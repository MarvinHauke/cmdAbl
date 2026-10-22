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

/**
 * The ranges of `input` between its chain separators, empty ones included (`a; ;b` has three).
 * A `;` separates unless it is inside quotes or escaped with a backslash — the same quoting rules as
 * `tokenize`. `end` is the offset of the `;` (or the end of the input); the next range starts after it.
 */
export function chainSegments(input: string): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < input.length) i++;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "\\" && i + 1 < input.length) {
      i++;
    } else if (ch === ";") {
      segments.push({ start, end: i });
      start = i + 1;
    }
  }
  segments.push({ start, end: input.length });
  return segments;
}

/** One command of a `;` chain: its text (trimmed) and where it sits in the input. */
export interface ChainPart {
  text: string;
  start: number;
  end: number;
}

/**
 * Split a line into its `;`-separated commands (plan 0017): empty parts and a trailing `;` are dropped,
 * `";"` in quotes stays text, and a word ending in `;` splits (`mute /Kick; solo /Bass`).
 */
export function splitChain(input: string): ChainPart[] {
  const parts: ChainPart[] = [];
  for (const { start, end } of chainSegments(input)) {
    const raw = input.slice(start, end);
    const text = raw.trim();
    if (!text) continue;
    const lead = raw.length - raw.trimStart().length;
    parts.push({ text, start: start + lead, end: start + lead + text.length });
  }
  return parts;
}

/** `-6`, `-0.5`, `+2`, `.5`, `inf`, `-inf`, `+inf`: a number, which the parser reads as a value and never as an option. */
export const NUMBERISH = /^(?:[+-]?(?:\d+\.?\d*|\.\d+)|[+-]?inf)$/i;

/** Quote a value for insertion into a command line if it needs it. */
export function quoteIfNeeded(value: string): string {
  // A leading dash is quoted too, or the word would re-parse as an option — except a number, which is a value.
  if (value !== "" && (!value.startsWith("-") || NUMBERISH.test(value)) && !/[\s"'\\;]/.test(value)) return value; // `;` separates commands outside quotes
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}
