import type { MidiMessage } from "../../ableton/bridgeOps.js";

/** The newest 20 messages, newest first, one line each: `cc  ch1  37  value 64`. */
export function monitorLines(messages: readonly MidiMessage[], limit = 20): string[] {
  return [...messages]
    .reverse()
    .slice(0, limit)
    .map((m) => `${m.type.padEnd(8)} ch${String(m.channel).padEnd(2)} ${m.type === "pb" ? "" : `number ${String(m.number).padEnd(3)} `}value ${m.value}`.trimEnd());
}
