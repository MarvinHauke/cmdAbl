// The manuals `man <topic>` can open. A pure table so lookup and the topic
// list are testable without Live. `search` is reserved for per-topic search
// (`man ableton <words>`), which is not part of the command yet.

export interface ManTopic {
  url: string;
  /** Not used yet: build a search URL from the words after the topic. */
  search?: (words: string[]) => string;
}

export const TOPICS: Readonly<Record<string, ManTopic>> = {
  // Redirects to the manual of the current Live version, so no version number here.
  ableton: { url: "https://www.ableton.com/en/manual/" },
  // `site_url` in mkdocs.yml.
  cmdabl: { url: "https://marvinhauke.github.io/cmdAbl/" },
};

/** Topic names in table order. */
export function topicNames(topics: Readonly<Record<string, ManTopic>> = TOPICS): string[] {
  return Object.keys(topics);
}

/** Case-insensitive lookup; undefined for an unknown topic. */
export function findTopic(
  name: string,
  topics: Readonly<Record<string, ManTopic>> = TOPICS,
): ManTopic | undefined {
  const key = name.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(topics, key) ? topics[key] : undefined;
}

/** "ableton, cmdabl" — for usage and not-found messages. */
export function topicList(topics: Readonly<Record<string, ManTopic>> = TOPICS): string {
  return topicNames(topics).join(", ");
}
