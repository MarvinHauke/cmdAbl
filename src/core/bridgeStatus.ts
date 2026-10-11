import type { BridgeResult, HelloInfo } from "../ableton/bridgeProtocol.js";
import { fail, ok, type CommandResult } from "../types.js";

// What `cmdabl --bridge` and the temporary GET /bridge report: one fresh
// `hello` round trip to the Remote Script, timed. Pure apart from the injected
// probe and clock, so it is tested without Live.

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
  ms: number;
}

export async function reportBridge(bridge: BridgeProbe, now: () => number = () => Date.now()): Promise<BridgeReport> {
  const started = now();
  let answer: BridgeResult<HelloInfo>;
  try {
    answer = await bridge.ping();
  } catch (e: unknown) {
    // The bridge promises not to throw; if it does, say so instead of crashing.
    answer = { ok: false, code: 1, text: `bridge failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const ms = Math.max(0, Math.round(now() - started));
  if (answer.ok) {
    const { script, v, ops } = answer.value;
    const text = `Remote Script ${script} is running (protocol v${v}, ${ms} ms; operations: ${ops.join(", ")})`;
    return { result: ok(text), line: `available: ${text}`, available: true, ms };
  }
  return {
    result: fail(answer.code, answer.text),
    line: `unavailable: ${answer.text} (after ${ms} ms)`,
    available: false,
    ms,
  };
}
