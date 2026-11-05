import type { BridgeResult } from "../../ableton/bridgeProtocol.js";
import type { MidiControls, MidiEvent, MidiMessage as StoredMessage } from "../../ableton/bridgeOps.js";
import { formatControl, listenControl, type MidiControl, type MidiMessage } from "./midi.js";
import type { MidiBinding, MidiEngine } from "./midiEngine.js";

// The module-facing MIDI port (`api.midi`, plan 0018) over the engine and the bridge's client.
// Pure and injectable: the extension passes the bridge calls and the push listener.

/** What `api.midi.setBindings` answers: how many controls the script forwards, and the rows that were refused (with the reason). */
export interface BindingsSet {
  count: number;
  refused: string[];
}

export interface ListenOptions {
  /** Also forward everything for a while so `last()` sees every message (learn, `midi monitor`). While it runs, bound lines do not fire. */
  monitor?: boolean;
  /** How long the monitor window lasts, 1-120 s (default 30). */
  seconds?: number;
}

/** `api.midi`: the bindings, what the script forwards, and the messages it kept. Never throws. */
export interface MidiPort {
  /**
   * Replace the table of bindings and tell the script to forward exactly those controls (plus anything
   * `listen` added). A row with `{}` and an operator that gives no value (press, release) is refused
   * and named in `refused`; the others are in effect. Fails like the bridge does (exit 5: script not running).
   */
  setBindings(list: readonly MidiBinding[]): Promise<BridgeResult<BindingsSet>>;
  /** The newest messages the script kept after `since` (a seq; 0 or absent = all it kept), oldest first. */
  last(since?: number): Promise<BridgeResult<{ last: number; messages: StoredMessage[] }>>;
  /**
   * Forward more than the bound controls: `"all"`, `"none"` (back to the bound ones only) or a list.
   * With `monitor` the controls are NOT remembered: the script keeps every message for `last()` for `seconds`
   * (it still pushes only the bound and the added controls) and bound lines pause meanwhile, whatever `controls` is.
   * A monitor window never turns into a permanent forward-everything, and `setBindings` ends it.
   */
  listen(controls: "all" | "none" | readonly MidiControl[], options?: ListenOptions): Promise<BridgeResult<{ count: number }>>;
  /**
   * The controls Live keeps for itself, as the script last reported them (after a map build): `[]` none, a list like
   * `["CC51/ch1", "N60/ch2", "PB/ch1"]` (a Cmd+M mapping or another script holds them, so cmdAbl never receives
   * them), or null when the script cannot tell. A control typed without a channel (`CC51`) is blocked when any
   * `CC51/chN` is listed.
   */
  blocked(): string[] | null;
  /** Be told when the blocked set changes (the script reports it after every map build). A throwing listener is skipped. */
  onBlocked(listener: (blocked: string[] | null) => void): () => void;
  /**
   * Every pushed MIDI event, as it arrives, for a live view (the monitor's cache): the events of the controls the
   * script listens to AND, during a monitor window, every message of the port (those carry `monitor: true`).
   * Bound lines never run for `monitor: true` events. Returns an unsubscribe; a throwing listener is skipped.
   * Keep the listener quick and read-only: it runs on the push path.
   */
  onEvent(listener: (event: MidiEvent) => void): () => void;
  /** The `midi.statusBar` setting: whether monitor and learn also show incoming messages in Live's status bar (default false). `listen` with `monitor` applies it. */
  statusBar(): Promise<boolean>;
  /** The `map.enabled` setting: false makes the engine drop every message (`map --off`). */
  enabled(): Promise<boolean>;
  /** Switch the engine on or off; stored in settings.json (`map.enabled`). Resolves false when it could not be saved (it is in effect for this session anyway). */
  setEnabled(on: boolean): Promise<boolean>;
}

export interface MidiPortDeps {
  engine: MidiEngine;
  /** midiListen of the bridge client. */
  listen: (controls: MidiControls, options: { monitor?: boolean; seconds?: number; status?: boolean }) => Promise<BridgeResult<{ count: number; monitor: boolean }>>;
  /** midiLast of the bridge client. */
  last: (since: number) => Promise<BridgeResult<{ last: number; messages: StoredMessage[] }>>;
  /** bridge: the last known blocked set, and its changes. */
  blocked: () => string[] | null;
  onBlocked: (callback: (blocked: string[] | null) => void) => () => void;
  /** Read `midi.statusBar`. */
  statusBar: () => Promise<boolean>;
  /** Read and write `map.enabled`. */
  enabled: () => Promise<boolean>;
  setEnabled: (on: boolean) => Promise<boolean>;
  now?: () => number;
}

export interface MidiRuntime {
  port: MidiPort;
  /** One pushed event: to the engine unless a monitor window is open. Resolves when its lines have finished. Never rejects. */
  intake(event: MidiEvent): Promise<void>;
}

export function createMidiPort(deps: MidiPortDeps): MidiRuntime {
  const now = deps.now ?? (() => Date.now());
  const eventListeners = new Set<(event: MidiEvent) => void>();
  let bound: MidiControl[] = [];
  let extra: "all" | "none" | MidiControl[] = "none";
  let monitorUntil = 0;

  /** The bound controls plus `more`, deduplicated, in the script's form. */
  function wantedWith(more: "all" | "none" | readonly MidiControl[]): MidiControls {
    if (more === "all") return "all";
    const seen = new Set<string>();
    const list: MidiControl[] = [];
    for (const control of [...bound, ...(more === "none" ? [] : more)]) {
      const key = formatControl(control);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(control);
    }
    return list.length === 0 ? "none" : list.map(listenControl);
  }

  return {
    port: {
      async setBindings(list) {
        const previous = deps.engine.bindings();
        const previousBound = bound;
        const { refused, kept } = deps.engine.setBindings(list);
        bound = kept.map((b) => b.control);
        const reply = await deps.listen(wantedWith(extra), {}); // no monitor: this ends a window too
        if (!reply.ok) {
          // The script did not take it: engine and script stay as they were.
          deps.engine.setBindings(previous);
          bound = previousBound;
          return reply;
        }
        monitorUntil = 0; // a binding just learned fires at once
        return { ok: true, value: { count: reply.value.count, refused } };
      },
      last: (since = 0) => deps.last(since),
      async listen(controls, options = {}) {
        if (options.monitor === true) {
          const seconds = options.seconds ?? 30;
          const status = await deps.statusBar().catch(() => false); // the setting decides whether the status bar shows the messages
          const reply = await deps.listen(wantedWith(extra), { monitor: true, seconds, status });
          if (!reply.ok) return reply;
          monitorUntil = now() + seconds * 1000;
          return { ok: true, value: { count: reply.value.count } };
        }
        const next = controls === "all" || controls === "none" ? controls : [...controls];
        const reply = await deps.listen(wantedWith(next), {});
        if (!reply.ok) return reply;
        extra = next;
        monitorUntil = 0;
        return { ok: true, value: { count: reply.value.count } };
      },
      onEvent: (listener) => {
        eventListeners.add(listener);
        return () => void eventListeners.delete(listener);
      },
      blocked: () => {
        try {
          return deps.blocked();
        } catch {
          return null;
        }
      },
      onBlocked: (listener) =>
        deps.onBlocked((blocked) => {
          try {
            listener(blocked);
          } catch {
            // one broken listener must not stop the others
          }
        }),
      statusBar: () => deps.statusBar().catch(() => false),
      enabled: () => deps.enabled().catch(() => true),
      setEnabled: (on) => deps.setEnabled(on).catch(() => false),
    },
    async intake(event) {
      for (const listener of [...eventListeners]) {
        try {
          listener(event);
        } catch {
          // one broken listener must not stop the others, or the bindings
        }
      }
      try {
        if (event.monitor === true) return; // a monitor-window copy: shown, never run
        if (monitorUntil > now()) return; // learning or monitoring: the lines wait
        const message: MidiMessage = { type: event.type, channel: event.channel, number: event.number, value: event.value, ...(event.monitor === true ? { monitor: true as const } : {}) };
        await deps.engine.handle(message);
      } catch {
        // an event must never take the host down
      }
    },
  };
}
