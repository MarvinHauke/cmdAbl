import { inlineJson } from "../../core/inlineJson.js";

const ENTRIES_PLACEHOLDER = "/*ENTRIES_PLACEHOLDER*/null";

/**
 * Put the index entries into the list page's `<script>`. The entries come from
 * a downloaded index, so they are escaped (`</script>`, line separators), and
 * the replacement is a function so `$&`-style patterns in the data stay literal.
 */
export function buildListPage(template: string, entries: unknown): string {
  return template.replace(ENTRIES_PLACEHOLDER, () => inlineJson(entries));
}
