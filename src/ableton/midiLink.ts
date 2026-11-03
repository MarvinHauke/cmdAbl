import { fail, type BridgeResult, type PushedEvent } from "./bridgeProtocol.js";
import type { Bridge } from "./bridgeClient.js";

// The extension's side of the MIDI push (plan 0018). Three jobs that must outlive a bridge client:
// the listeners of MIDI events (`onMidiEvent`), what the script was last told to listen to, and
// sending that again when the script has restarted (it forgets). `attachMidi(bridge)` connects a
// client to them; getBridge() calls it for every client it creates, so a recreated client keeps
// delivering to the same listeners.

/** One control to listen to: a kind, and optionally one channel (1-16) and one number (0-127); omitted = all. */
export interface MidiControl {
  type: "cc" | "note" | "pb";
  channel?: number;
  number?: number;
}

export type MidiControls = "all" | "none" | MidiControl[];

/** One pushed MIDI message. `time` is when the script received it (ms since the epoch, same clock as Date.now()). */
export interface MidiEvent {
  seq: number;
  type: "cc" | "note_on" | "note_off" | "pb";
  /** 1-16. */
  channel: number;
  /** CC or note number; 0 for pitch bend. */
  number: number;
  /** 0-127; pitch bend 0-16383. */
  value: number;
  time: number;
}

const TYPES = ["cc", "note_on", "note_off", "pb"];

/** The event in a pushed message, or null when a field is missing or has the wrong type. */
export function readMidiEvent(data: Record<string, unknown>): MidiEvent | null {
  const { seq, type, channel, number, value, t } = data;
  if (typeof type !== "string" || !TYPES.includes(type)) return null;
  if (![seq, channel, number, value, t].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { seq: seq as number, type: type as MidiEvent["type"], channel: channel as number, number: number as number, value: value as number, time: t as number };
}

/** The script's default monitor window (midi_listen without `seconds`). */
const DEFAULT_MONITOR_SECONDS = 30;

const listeners = new Set<(event: MidiEvent) => void>();

/** Listen to pushed MIDI events (from whichever bridge client is current). Returns a function that removes the listener. A listener that throws is skipped. */
export function onMidiEvent(callback: (event: MidiEvent) => void): () => void {
  listeners.add(callback);
  return () => void listeners.delete(callback);
}

/** Hand one pushed message to the listeners; a malformed one is dropped. Never throws. */
export function deliverPushedEvent(event: PushedEvent): void {
  if (event.name !== "midi") return;
  const midi = readMidiEvent(event.data);
  if (!midi) return;
  for (const listener of [...listeners]) {
    try {
      listener(midi);
    } catch {
      // one broken listener must not stop the others
    }
  }
}

let desired: MidiControls | null = null;
/** When the monitor window of the last accepted listen ends (ms since the epoch); 0 = no window. */
let monitorUntil = 0;
/** Whether the last accepted monitor listen asked for the status bar (the default). */
let monitorStatus = true;
/** Listens sent and not yet answered: a restart seen meanwhile is covered by them, so nothing is re-sent. */
let inFlight = 0;

/** What the script should listen to now; the last value given to `sendListen`. null = never asked. */
export function desiredControls(): MidiControls | null {
  return desired;
}

/** Forget what was asked (tests). */
export function resetMidiLink(): void {
  desired = null;
  monitorUntil = 0;
  inFlight = 0;
  listeners.clear();
}

/** Ask the script to listen. `monitor` also forwards everything for `seconds` (learn) and shows the messages in Live's status bar unless `status` is false; only `controls` is remembered. Never throws. */
export async function sendListen(
  bridge: Bridge,
  controls: MidiControls,
  options: { monitor?: boolean; seconds?: number; status?: boolean } = {},
): Promise<BridgeResult<{ count: number; monitor: boolean }>> {
  inFlight++;
  try {
    const args: Record<string, unknown> = { controls };
    if (options.monitor === true) {
      args.monitor = true;
      if (options.seconds !== undefined) args.seconds = options.seconds;
      if (options.status === false) args.status = false;
    }
    const reply = await bridge.request("midi_listen", args, { changes: true, token: true });
    if (!reply.ok) return reply;
    const { count, monitor } = reply.value;
    if (typeof count !== "number") return fail(1, "bad reply from the Remote Script (midi_listen)");
    // Only an accepted listen becomes what a restarted script is told again.
    desired = controls;
    monitorStatus = options.status !== false;
    monitorUntil = monitor === true ? Date.now() + (options.seconds ?? DEFAULT_MONITOR_SECONDS) * 1000 : 0;
    return { ok: true, value: { count, monitor: monitor === true } };
  } catch {
    return fail(1, "midi_listen failed");
  } finally {
    inFlight--;
  }
}

/**
 * Connect a bridge client: its pushed events go to the `onMidiEvent` listeners, and when the script
 * (re)starts the last listen is sent again (with the rest of an open monitor window). A script that is down or too old simply does not answer.
 */
export function attachMidi(bridge: Bridge): void {
  bridge.onEvent?.(deliverPushedEvent);
  bridge.onScriptStart?.(() => {
    if (desired === null || inFlight > 0) return;
    // A monitor window that is still open goes on for the rest of its time; an ended one is not reopened.
    const remaining = Math.ceil((monitorUntil - Date.now()) / 1000);
    void sendListen(bridge, desired, remaining >= 1 ? { monitor: true, seconds: remaining, status: monitorStatus } : {});
  });
}
