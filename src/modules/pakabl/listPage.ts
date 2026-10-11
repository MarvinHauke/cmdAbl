import { inlineJson } from "../../core/inlineJson.js";

const ENTRIES_PLACEHOLDER = "/*ENTRIES_PLACEHOLDER*/null";

/**
 * Put the index entries into the list page's `<script>`. The entries come from
 * a downloaded index, so they are escaped (`</script>`, line separators), and
 * the replacement is a function so `$&`-style patterns in the data stay literal.
 * Throws when the template lacks the placeholder; `list` turns that into a
 * failed result.
 */
export function buildListPage(template: string, entries: unknown): string {
  // A drifted placeholder would silently show an empty list: fail instead.
  if (!template.includes(ENTRIES_PLACEHOLDER)) {
    throw new Error(`pakabl list page has no ${ENTRIES_PLACEHOLDER} placeholder`);
  }
  return template.replace(ENTRIES_PLACEHOLDER, () => inlineJson(entries));
}
