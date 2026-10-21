import type { TrackScope } from "../core/types.js";
import type { Bridge } from "./bridgeClient.js";
import { readTags, writeTags, type TagEntry, type TagsWritten } from "./bridgeOps.js";
import { fail, type BridgeResult } from "./bridgeProtocol.js";
import type { ObjectNode } from "./objectTree.js";

// Track tags come from the Remote Script (Track.get_data). Like the chain names (chainNames.ts) they
// are *read from a cache* while the object tree is built, and the cache is refreshed in the
// background, so a command never waits for the script. A cached tag list belongs to a track only
// while the track at that place still has the name it had when the tags were read.
//
// `ready()` says whether the cache ever held a complete answer; `refreshNow()` is the awaitable
// read for a command that needs tags (e.g. `#fx`) and has to tell "no such tag" from "script not
// running".

/** Minimum time between two background refreshes; longer while the script is known to be unavailable. */
export const TAG_REFRESH_INTERVAL_MS = 2000;
export const TAG_UNAVAILABLE_INTERVAL_MS = 10000;

const keyOf = (scope: TrackScope, route: number[]): string => `${scope}:${route.join(".")}`;

export class TagCache {
  private entries = new Map<string, TagEntry>();
  private loaded = false;
  private inFlight: { promise: Promise<BridgeResult<void>>; gen: number } | null = null;
  /** Counts finished writes: a read that started before the latest write is stale and is neither shared nor applied. */
  private writeGen = 0;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private trailing: unknown = null;
  private dirty = false;
  private latest: Bridge | null = null;
  private lastSummary = "";

  constructor(
    private readonly setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => {
      const t = setTimeout(fn, ms);
      (t as { unref?: () => void }).unref?.();
      return t;
    },
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  /** The tags of the track at this place, or undefined when none are known or the name differs. Never an empty list. */
  get(scope: TrackScope, route: number[], name: string): string[] | undefined {
    const entry = this.entries.get(keyOf(scope, route));
    return entry && entry.name === name && entry.tags.length > 0 ? entry.tags : undefined;
  }

  /** True once a complete answer from the script has been cached (an empty Set of tags counts). */
  ready(): boolean {
    return this.loaded;
  }

  /**
   * Ask the script for all tags now and replace the cache with the answer. On failure the old entries
   * stay (a stale tag list is caught by the name check and, for a write, by `expectName`). Concurrent
   * calls share one request. Never throws.
   */
  refreshNow(bridge: Bridge): Promise<BridgeResult<void>> {
    const running = this.inFlight;
    if (running) {
      this.latest = bridge;
      if (running.gen === this.writeGen) {
        this.dirty = true;
        return running.promise;
      }
      // That read began before a write finished: its answer may lack the write. Wait for it (its result
      // is discarded) and read again, so `#fx` right after `tag … fx` sees the new tag.
      return running.promise.then(() => this.refreshNow(bridge));
    }
    this.lastAttempt = Date.now();
    this.dirty = false;
    const gen = this.writeGen;
    const promise = this.load(bridge, gen).finally(() => {
      this.inFlight = null;
      if (this.dirty && this.latest) {
        this.dirty = false;
        try {
          void this.scheduleRefresh(this.latest, Date.now());
        } catch {
          // an uncaught error in a callback would take the host down
        }
      }
    });
    this.inFlight = { promise, gen };
    return promise;
  }

  private async load(bridge: Bridge, gen: number): Promise<BridgeResult<void>> {
    try {
      const reply = await readTags(bridge);
      if (!reply.ok) {
        this.say(`cmdAbl: tags refresh failed (code ${reply.code}): ${reply.text}`);
        return reply;
      }
      if (gen !== this.writeGen) return { ok: true, value: undefined }; // a write finished meanwhile: this answer is stale
      this.entries = new Map(reply.value.map((e) => [keyOf(e.scope, e.route), e]));
      this.loaded = true;
      this.say(`cmdAbl: tags refresh: ${reply.value.length} tagged tracks`);
      return { ok: true, value: undefined };
    } catch {
      return fail(1, "tags refresh failed");
    }
  }

  /**
   * Stale-while-revalidate: start a refresh in the background unless one is running or the last
   * attempt is recent (then one trailing refresh bounds the staleness). Called whenever a tree is
   * built. Returns the promise only for tests.
   */
  scheduleRefresh(bridge: Bridge, now: number = Date.now()): Promise<BridgeResult<void>> | null {
    this.latest = bridge;
    if (this.inFlight) {
      this.dirty = true;
      return null;
    }
    const wait = bridge.state() === "unavailable" ? TAG_UNAVAILABLE_INTERVAL_MS : TAG_REFRESH_INTERVAL_MS;
    if (now - this.lastAttempt < wait) {
      if (this.trailing === null) {
        this.trailing = this.setTimer(() => {
          this.trailing = null;
          try {
            if (this.latest) void this.scheduleRefresh(this.latest, Date.now());
          } catch {
            // see refreshNow
          }
        }, Math.max(0, wait - (now - this.lastAttempt)));
      }
      return null;
    }
    return this.refreshNow(bridge);
  }

  /**
   * Write the tags of one track and, when the script confirms, update the cache at once from what
   * Live stored; the next build then also refreshes in the background. Same result as `writeTags`.
   */
  async write(bridge: Bridge, track: Pick<ObjectNode, "scope" | "route" | "name">, tags: string[]): Promise<BridgeResult<TagsWritten>> {
    const result = await writeTags(bridge, track, tags);
    if (result.ok) {
      this.writeGen++;
      const key = keyOf(track.scope, track.route);
      if (result.value.tags.length > 0) this.entries.set(key, { scope: track.scope, route: track.route.slice(), name: result.value.name, tags: result.value.tags });
      else this.entries.delete(key);
      this.lastAttempt = Number.NEGATIVE_INFINITY; // the next tree build reconciles with the script
    }
    return result;
  }

  private say(line: string): void {
    if (line === this.lastSummary) return;
    this.lastSummary = line;
    try {
      this.log(line);
    } catch {
      // logging must never fail a refresh
    }
  }
}

let shared: TagCache | null = null;
/** The one cache of this Extension Host. */
export function getTagCache(): TagCache {
  if (!shared) shared = new TagCache();
  return shared;
}
