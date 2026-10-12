import type { TrackScope } from "../types.js";
import type { Bridge } from "./bridgeClient.js";
import { chains as fetchChains } from "./bridgeOps.js";

// Chain names come from the Remote Script (the SDK's Chain has no name). The
// object tree is built synchronously from the SDK on every command, so names
// are *read from a cache* during the build and the cache is refreshed in the
// background — a command never waits for the script (0001 §6, "Chain names in
// the tree"). A cached name is used only while the SDK still sees the same rack
// (handle id) with the same number of chains; otherwise the rack's chains are
// simply absent from the tree until the next refresh.

/** The minimal shape of an SDK device/track this module needs (structural, so tests need no SDK). */
export interface DeviceLike {
  handle: { id: { toString(): string } };
  name: string;
  chains?: ChainLike[];
}
export interface ChainLike {
  handle: { id: { toString(): string } };
  devices: DeviceLike[];
}
export interface TrackLike {
  devices: DeviceLike[];
}
export interface SongLike {
  tracks: TrackLike[];
  returnTracks: TrackLike[];
  mainTrack: TrackLike;
}

/** A rack device the SDK sees: where it is and which chains (by handle id, in order) it has. */
export interface RackRef {
  scope: TrackScope;
  /** Route to the rack device: [track, device, chain, device, …]. */
  route: number[];
  handleId: string;
  /** The SDK's chain handle ids in `rack.chains` order: names are valid only for this exact sequence. */
  chainIds: string[];
}

/** Every rack of the Set, nested ones included (a rack is any device with `chains`). */
export function findRacks(song: SongLike): RackRef[] {
  const found: RackRef[] = [];
  const visit = (devices: DeviceLike[], prefix: number[], scope: TrackScope): void => {
    devices.forEach((device, d) => {
      const route = [...prefix, d];
      if (Array.isArray(device.chains)) {
        found.push({ scope, route, handleId: device.handle.id.toString(), chainIds: device.chains.map((c) => c.handle.id.toString()) });
        device.chains.forEach((chain, c) => visit(chain.devices, [...route, c], scope));
      }
    });
  };
  const scan = (tracks: TrackLike[], scope: TrackScope): void => tracks.forEach((t, i) => visit(t.devices, [i], scope));
  scan(song.tracks, "regular");
  scan(song.returnTracks, "return");
  scan([song.mainTrack], "master");
  return found;
}

const keyOf = (scope: TrackScope, route: number[], handleId: string): string => `${scope}:${route.join(".")}:${handleId}`;

export interface ChainEntry {
  kind: "rack" | "drum";
  names: string[];
  notes: Array<number | null>;
  /** The chain handle ids the names were fetched for (same order). */
  chainIds: string[];
}

/** Minimum time between two refreshes; longer while the script is known to be unavailable. */
export const REFRESH_INTERVAL_MS = 2000;
export const UNAVAILABLE_INTERVAL_MS = 10000;

export class ChainNameCache {
  private entries = new Map<string, ChainEntry>();
  private inFlight: Promise<void> | null = null;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private trailing: unknown = null;
  private dirty = false;
  private latest: { racks: RackRef[]; bridge: Bridge } | null = null;

  private lastSummary = "";

  /**
   * `setTimer` and `log` are injectable for tests; the default timer is unref'd so it never keeps
   * the host alive, the default log is the extension log (one line per refresh, only when the
   * line differs from the previous one).
   */
  constructor(
    private readonly setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => {
      const t = setTimeout(fn, ms);
      (t as { unref?: () => void }).unref?.();
      return t;
    },
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  /**
   * Names for a rack, or null when unknown or when the SDK no longer shows the
   * same chains (same handle ids in the same order). A swapped pad, or a chain
   * deleted and another added, therefore never gets the old names.
   */
  get(scope: TrackScope, route: number[], handleId: string, chainIds: string[]): ChainEntry | null {
    const entry = this.entries.get(keyOf(scope, route, handleId));
    if (!entry || entry.names.length !== chainIds.length) return null;
    return entry.chainIds.every((id, i) => id === chainIds[i]) ? entry : null;
  }

  /**
   * Ask the script for the names of all `racks` in one request and replace the
   * cache with the answer (a rack that failed is left out). Never throws; on an
   * outer failure the old entries stay (a stale name is caught by `select`'s
   * expectName, an absent one only hides the chain until the next refresh).
   */
  async refresh(racks: RackRef[], bridge: Bridge): Promise<void> {
    if (racks.length === 0) {
      this.entries = new Map();
      return;
    }
    try {
      const reply = await fetchChains(bridge, racks);
      if (!reply.ok) {
        this.say(`cmdAbl: chains refresh: ${racks.length} racks asked, request failed (code ${reply.code}): ${reply.text}`);
        return;
      }
      const next = new Map<string, ChainEntry>();
      const skipped: string[] = [];
      let names = 0;
      racks.forEach((rack, i) => {
        const r = reply.value[i];
        if (r?.ok && r.value.names.length === rack.chainIds.length) {
          next.set(keyOf(rack.scope, rack.route, rack.handleId), { ...r.value, chainIds: rack.chainIds });
          names += r.value.names.length;
        } else if (r?.ok) {
          skipped.push(`${rack.scope} [${rack.route.join(",")}]: script has ${r.value.names.length} chains, SDK ${rack.chainIds.length}`);
        } else {
          skipped.push(`${rack.scope} [${rack.route.join(",")}]: ${r?.text ?? "no answer"}`);
        }
      });
      this.entries = next;
      this.say(
        `cmdAbl: chains refresh: ${racks.length} racks asked, ${next.size} answered, ${names} chain names` +
          (skipped.length > 0 ? `; skipped: ${skipped.join("; ")}` : ""),
      );
    } catch {
      // nothing may throw out of a background refresh
    }
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

  /**
   * Stale-while-revalidate: start a refresh in the background unless one is
   * running or the last attempt is recent. Called whenever a tree is built, so
   * the palette opening warms the cache before the user commits a command.
   * Returns the promise only for tests.
   */
  scheduleRefresh(racks: RackRef[], bridge: Bridge, now: number = Date.now()): Promise<void> | null {
    this.latest = { racks, bridge };
    if (this.inFlight) {
      this.dirty = true; // run once more when the current one is done, with the newest list
      return null;
    }
    const wait = bridge.state() === "unavailable" ? UNAVAILABLE_INTERVAL_MS : REFRESH_INTERVAL_MS;
    if (now - this.lastAttempt < wait) {
      // Throttled: one trailing refresh bounds the staleness to the interval (not "until some later build").
      if (this.trailing === null) {
        this.trailing = this.setTimer(() => {
          this.trailing = null;
          try {
            if (this.latest) void this.scheduleRefresh(this.latest.racks, this.latest.bridge, Date.now());
          } catch {
            // an uncaught error in a timer would take the host down
          }
        }, Math.max(0, wait - (now - this.lastAttempt)));
      }
      return null;
    }
    this.lastAttempt = now;
    this.dirty = false;
    this.inFlight = this.refresh(racks, bridge).finally(() => {
      this.inFlight = null;
      if (this.dirty && this.latest) {
        this.dirty = false;
        try {
          void this.scheduleRefresh(this.latest.racks, this.latest.bridge, Date.now());
        } catch {
          // see above
        }
      }
    });
    return this.inFlight;
  }
}

let shared: ChainNameCache | null = null;
/** The one cache of this Extension Host. */
export function getChainNameCache(): ChainNameCache {
  if (!shared) shared = new ChainNameCache();
  return shared;
}
