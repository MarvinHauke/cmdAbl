import { PROTOCOL_VERSION, SCRIPT_VERSION, TEXT_OUTDATED, fail, type BridgeResult, type HelloInfo } from "./bridgeProtocol.js";
import type { Bridge, BridgeState } from "./bridgeClient.js";

// An in-memory Bridge for unit tests of modules and the platform: scripted
// replies per op, a record of calls, no socket, no timers.

export interface FakeBridgeOptions {
  /** Op → result or a failure. A missing op answers like an old script. */
  ops?: Record<string, (args: Record<string, unknown>) => BridgeResult<Record<string, unknown>>>;
  /** `false` = the script is not reachable (exit code 5). */
  running?: boolean;
  unavailableText?: string;
}

export interface FakeBridge extends Bridge {
  calls: Array<{ op: string; args: Record<string, unknown>; changes: boolean }>;
}

export function createFakeBridge(options: FakeBridgeOptions = {}): FakeBridge {
  const running = options.running ?? true;
  const ops = options.ops ?? {};
  const hello: HelloInfo = { script: SCRIPT_VERSION, v: PROTOCOL_VERSION, ops: ["hello", ...Object.keys(ops)] };
  let state: BridgeState = "unknown";
  const calls: FakeBridge["calls"] = [];
  const available = async (): Promise<BridgeResult<HelloInfo>> => {
    state = running ? "available" : "unavailable";
    return running ? { ok: true, value: hello } : fail(5, options.unavailableText ?? "Remote Script not running");
  };
  return {
    calls,
    state: () => state,
    available,
    async request(op, args = {}, opts = {}) {
      calls.push({ op, args, changes: opts.changes ?? false });
      const ready = await available();
      if (!ready.ok) return ready;
      const handler = ops[op];
      if (!handler) return fail(5, TEXT_OUTDATED);
      return handler(args);
    },
    close() {},
  };
}
