// The order the user meets the commands in: a fixed list of topic titles; each top-level command
// names its topic (`CommandNode.topic`). `help` and the generated command reference group by it instead of sorting
// alphabetically. A command that is in no topic (a third-party module's) lands under "More
// commands", sorted by name. Pure.

/** The topics in the order a user meets them. A command names its topic (`CommandNode.topic`). */
export const TOPIC_ORDER: readonly string[] = [
  "Find and select",
  "Mix",
  "Tags",
  "Look things up",
  "Recent commands",
  "Extensions",
  "cmdAbl itself",
];

export const MORE_TITLE = "More commands";

/**
 * The items grouped by topic in `TOPIC_ORDER`, each topic's items in the given (registration) order.
 * Items with no or an unknown topic go last under "More commands", sorted by name. Topics with no
 * item are left out.
 */
export function groupByTopic<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  topicOf: (item: T) => string | undefined,
): Array<{ title: string; items: T[] }> {
  const groups: Array<{ title: string; items: T[] }> = [];
  for (const title of TOPIC_ORDER) {
    const found = items.filter((item) => topicOf(item) === title);
    if (found.length) groups.push({ title, items: found });
  }
  const rest = items.filter((item) => !TOPIC_ORDER.includes(topicOf(item) ?? "")).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "en"));
  if (rest.length) groups.push({ title: MORE_TITLE, items: rest });
  return groups;
}

/** The `help` list: a heading per topic, its commands indented below it with their summaries. */
export function commandListText(defs: ReadonlyArray<{ name: string; description: string; topic?: string }>): string {
  return groupByTopic(defs, (def) => def.name, (def) => def.topic)
    .flatMap((g, i) => [...(i ? [""] : []), g.title, ...g.items.map((def) => `  ${def.name.padEnd(12)} ${def.description}`)])
    .join("\n");
}
