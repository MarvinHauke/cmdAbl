import { SCRIPT_VERSION, type BridgeResult, type HelloInfo } from "../ableton/bridgeProtocol.js";
import { ExitCode, fail, ok, type CommandResult } from "../types.js";

// What `cmdabl --bridge` (one fresh `hello`, answered at once) and the
// temporary GET /bridge (20 of them, timed, one after the other, as min /
// median / max — the script drains its socket once per display tick, so single
// values scatter) report. Pure apart from the injected probe and clock: tested without Live.

/** The part of the Bridge this needs: one fresh hello that never throws. */
export interface BridgeProbe {
  ping(): Promise<BridgeResult<HelloInfo>>;
}

export interface BridgeReport {
  /** For the command: exit 0 with the status line, or the bridge's own failure. */
  result: CommandResult;
  /** One plain-text line for the diagnostic endpoint. */
  line: string;
  available: boolean;
  /** Milliseconds: the median of the round trips (or the first one's, on failure). */
  ms: number;
}

/** How many hellos one report sends (one after the other). */
export const ROUND_TRIPS = 20;
/** Upper bound of the random pause between two pings. */
export const MAX_PAUSE_MS = 150;

export function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export async function reportBridge(
  bridge: BridgeProbe,
  now: () => number = () => Date.now(),
  options: {
    roundTrips?: number;
    shippedVersion?: string;
    /** Pause before each further ping, so the samples start at random phases of the script's tick. */
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<BridgeReport> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const total = Math.max(1, options.roundTrips ?? ROUND_TRIPS);
  const shipped = options.shippedVersion ?? SCRIPT_VERSION;

  /** One timed ping; a throwing probe becomes a failure (the bridge promises not to throw). */
  async function timedPing(): Promise<{ answer: BridgeResult<HelloInfo>; ms: number }> {
    const started = now();
    let answer: BridgeResult<HelloInfo>;
    try {
      answer = await bridge.ping();
    } catch (e: unknown) {
      answer = { ok: false, code: 1, text: `bridge failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { answer, ms: Math.max(0, Math.round(now() - started)) };
  }

  const first = await timedPing();
  if (!first.answer.ok) {
    return {
      result: fail(first.answer.code, first.answer.text),
      line: `unavailable: ${first.answer.text} (after ${first.ms} ms)`,
      available: false,
      ms: first.ms,
    };
  }
  const hello = first.answer.value;
  const times = [first.ms];
  for (let i = 1; i < total; i++) {
    // Back-to-back pings would all land just after a drain tick and read as
    // the worst case; a random pause spreads them over the tick.
    await sleep(Math.floor(random() * (MAX_PAUSE_MS + 1)));
    const next = await timedPing(); // one after the other, never in parallel
    if (!next.answer.ok) {
      const text =
        `Remote Script ${hello.script} answered ${times.length} of ${total} round trips, ` +
        `then failed: ${next.answer.text}`;
      return { result: fail(ExitCode.FAILURE, text), line: `unstable: ${text}`, available: false, ms: next.ms };
    }
    times.push(next.ms);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const med = median(sorted);
  const version = hello.script === shipped ? hello.script : `${hello.script} (this extension ships ${shipped})`;
  const trips = total === 1 ? `${first.ms} ms` : `${total} round trips: min ${min} ms, median ${med} ms, max ${max} ms`;
  const text = `Remote Script ${version} is running (protocol v${hello.v}; ${trips}; operations: ${hello.ops.join(", ")})`;
  return { result: ok(text), line: `available: ${text}`, available: true, ms: med };
}
