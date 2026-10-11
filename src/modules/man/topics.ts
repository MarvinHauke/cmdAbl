// The manuals `man <topic>` can open. A pure table so lookup, search and the
// topic list are testable without Live.

export interface ManTopic {
  url: string;
  /** Build a search URL from the words after the topic; absent = the topic has no search. */
  search?: (words: string[]) => string;
}

/**
 * Percent-encode for a query value. `encodeURIComponent` leaves `! ' ( ) *`
 * alone; they are encoded too so the URL has no quote characters (core's
 * `isHttpsUrl` refuses those). No `URL`/`URLSearchParams`: the Extension Host
 * does not provide them.
 */
export function encodeQuery(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// The manual has no search of its own. `site:` is only documented by
// DuckDuckGo for a bare domain, hence `inurl:` for the manual's path.
const ABLETON_SCOPE = "site:ableton.com inurl:live-manual";

export function abletonSearchUrl(words: string[]): string {
  const typed = words.join(" ").trim().replace(/\s+/g, " ");
  return `https://duckduckgo.com/?q=${encodeQuery(`${typed} ${ABLETON_SCOPE}`)}`;
}

export const TOPICS: Readonly<Record<string, ManTopic>> = {
  // Redirects to the manual of the current Live version, so no version number here.
  ableton: { url: "https://www.ableton.com/en/manual/", search: abletonSearchUrl },
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
