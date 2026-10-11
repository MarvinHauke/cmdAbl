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

// The manual has no search of its own, so words are sent to a web search
// scoped to the manual's path. The engine lives here only: changing it is a
// one-line edit. Ecosia documents `site:` (provider-dependent), not `inurl:`,
// so the manual's path goes into `site:`.
export const SEARCH_ENGINE = { name: "Ecosia", urlPrefix: "https://www.ecosia.org/search?q=" } as const;
const ABLETON_SCOPE = "site:ableton.com/en/live-manual";

export function abletonSearchUrl(words: string[]): string {
  const typed = words.join(" ").trim().replace(/\s+/g, " ");
  return `${SEARCH_ENGINE.urlPrefix}${encodeQuery(`${typed} ${ABLETON_SCOPE}`)}`;
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
