// The Remote Script protocol, pure part: message shapes, reply validation and
// the mapping from script error codes to cmdAbl exit codes.
// Specified in docs/feature-plans/0001-path-addressed-objects-and-commands.md
// ("Phase 4 protocol proposal"). No I/O here — everything is unit-tested.

import { ExitCode } from "../types.js";

export const PROTOCOL_VERSION = 1;
/** The Remote Script version this extension was built with (VERSION in protocol.py). */
export const SCRIPT_VERSION = "0.2.0";
export const BRIDGE_PORT = 27185;
export const BRIDGE_HOST = "127.0.0.1";
/** ≥ 300 ms by 0004 (the script drains ~10 Hz); 500 ms is an assumption until measured. */
export const REQUEST_TIMEOUT_MS = 500;

/** Exit codes a bridge failure can carry: 5 = unavailable, 1 = failure / unknown end state. */
export type BridgeFailureCode = typeof ExitCode.FAILURE | typeof ExitCode.UNAVAILABLE;

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; code: BridgeFailureCode; text: string };

export interface HelloInfo {
  script: string;
  v: number;
  ops: string[];
}

export const TEXT_STALE = "the Live Set changed; run the command again";
export const TEXT_OUTDATED = "installed Remote Script is outdated; run `cmdabl --setup` and restart Live";
export const TEXT_NOT_RUNNING =
  "Remote Script not running (enable cmdAbl as a control surface in Live's preferences, then restart Live)";
export const TEXT_NOT_INSTALLED = "Remote Script not installed; run `cmdabl --setup` and restart Live";
export const TEXT_NO_ANSWER = "the Remote Script did not answer; check Live";

export function fail(code: BridgeFailureCode, text: string): BridgeResult<never> {
  return { ok: false, code, text };
}

export function encodeRequest(id: string, op: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, id, op, args });
}

export type ParsedReply =
  | { kind: "ok"; id: string; v: number; result: Record<string, unknown> }
  | { kind: "error"; id: string; v: number; code: string; text: string }
  | { kind: "malformed"; id: string | null; why: string };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Validate one datagram from the script. Never throws. */
export function parseReply(raw: string): ParsedReply {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: "malformed", id: null, why: "reply is not JSON" };
  }
  if (!isObject(msg)) return { kind: "malformed", id: null, why: "reply is not an object" };
  const id = typeof msg.id === "string" ? msg.id : null;
  if (id === null) return { kind: "malformed", id, why: "reply without id" };
  if (typeof msg.v !== "number") return { kind: "malformed", id, why: "reply without v" };
  if (msg.ok === true) {
    if (!isObject(msg.result)) return { kind: "malformed", id, why: "ok reply without result object" };
    return { kind: "ok", id, v: msg.v, result: msg.result };
  }
  if (msg.ok === false) {
    const e = msg.error;
    if (!isObject(e) || typeof e.code !== "string" || typeof e.text !== "string") {
      return { kind: "malformed", id, why: "error reply without code and text" };
    }
    return { kind: "error", id, v: msg.v, code: e.code, text: e.text };
  }
  return { kind: "malformed", id, why: "reply without ok" };
}

/** The `hello` result, validated. */
export function parseHello(result: Record<string, unknown>): HelloInfo | null {
  const { script, v, ops } = result;
  if (typeof script !== "string" || typeof v !== "number") return null;
  if (!Array.isArray(ops) || !ops.every((o) => typeof o === "string")) return null;
  return { script, v, ops: ops as string[] };
}

/** Script error code → exit code and text (table in 0001 §2). */
export function mapScriptError(code: string, text: string): BridgeResult<never> {
  switch (code) {
    case "stale":
    case "out_of_range":
      return fail(ExitCode.FAILURE, TEXT_STALE);
    case "unknown_op":
    case "protocol_mismatch":
      return fail(ExitCode.UNAVAILABLE, TEXT_OUTDATED);
    default:
      return fail(ExitCode.FAILURE, text || code);
  }
}
