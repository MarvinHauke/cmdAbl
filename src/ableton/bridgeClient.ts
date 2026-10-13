import * as dgram from "node:dgram";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  TEXT_FORBIDDEN,
  TEXT_NOT_INSTALLED,
  TEXT_NO_TOKEN,
  TEXT_NOT_RUNNING,
  TEXT_NO_ANSWER,
  TEXT_OUTDATED,
  encodeRequest,
  fail,
  mapScriptError,
  parseHello,
  parseReply,
  type BridgeResult,
  type HelloInfo,
} from "./bridgeProtocol.js";
import type { InstalledScript } from "./installedScript.js";
import type { TokenSource } from "./bridgeToken.js";

// The request/response client. It sits behind the `Bridge` interface so
// modules and tests never touch the UDP socket (see bridgeFake.ts).

/** Cached view for callers that must not wait (the palette). */
export type BridgeState = "unknown" | "available" | "unavailable";

export interface Bridge {
  /** Cached state only; never sends, never waits. */
  state(): BridgeState;
  /** Runs `hello` when the state is unknown; the answer is cached. Never throws. */
  available(): Promise<BridgeResult<HelloInfo>>;
  /**
   * Always sends a fresh `hello` (ignores the cache) and updates the cached
   * state with the outcome: a failure → "unavailable", a success → "available".
   * For diagnostics (timing, "did the script go away"). Never throws. It does not join or
   * replace a `hello` already in flight: a concurrent `ping()` and `available()` are two
   * separate hellos that can end differently, and the later one wins. The state is a hint.
   */
  ping(): Promise<BridgeResult<HelloInfo>>;
  /**
   * One request. `changes` marks a request that alters Live: a timeout then
   * means "end state unknown". `token` adds the access token (writing ops): it
   * is read lazily from its file and re-read once when the script answers
   * `forbidden`. Never throws.
   */
  request(
    op: string,
    args?: Record<string, unknown>,
    options?: { changes?: boolean; token?: boolean },
  ): Promise<BridgeResult<Record<string, unknown>>>;
  close(): void;
}

/** What the client needs from a socket: send one datagram, receive datagrams. */
export interface Transport {
  send(data: string, done: (error: Error | null) => void): void;
  onMessage(listener: (data: string) => void): void;
  close(): void;
}

export interface BridgeClientOptions {
  transport: Transport;
  installed: () => InstalledScript;
  /** Where the access token for writing ops comes from; without one writing ops answer exit code 5. */
  token?: TokenSource;
  timeoutMs?: number;
  /** Test hooks. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createBridgeClient(options: BridgeClientOptions): Bridge {
  const { transport } = options;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const pending = new Map<string, (r: BridgeResult<Record<string, unknown>>) => void>();
  let counter = 0;
  let cached: BridgeResult<HelloInfo> | null = null;
  let helloInFlight: Promise<BridgeResult<HelloInfo>> | null = null;
  let closed = false;

  transport.onMessage((raw) => {
    try {
      const reply = parseReply(raw);
      if (reply.id === null || !("id" in reply)) return; // not ours to answer
      const settle = pending.get(reply.id);
      if (!settle) return; // late or unknown id: ignore
      pending.delete(reply.id);
      if (reply.kind === "ok") settle({ ok: true, value: reply.result });
      else if (reply.kind === "error") {
        // A protocol mismatch answers with the script's v; `hello` is never affected.
        settle(mapScriptError(reply.code, reply.text));
      } else settle(fail(1, `bad reply from the Remote Script: ${reply.why}`));
    } catch {
      // nothing may throw out of a socket callback
    }
  });

  /** Send and wait; resolves with the reply, "timeout" or "send_failed". */
  function exchange(
    op: string,
    args: Record<string, unknown>,
  ): Promise<BridgeResult<Record<string, unknown>> | "timeout" | "send_failed"> {
    return new Promise((resolve) => {
      if (closed) return resolve(fail(1, "bridge closed"));
      const id = `r${++counter}`;
      let timer: unknown;
      const finish = (value: BridgeResult<Record<string, unknown>> | "timeout" | "send_failed") => {
        clearTimer(timer);
        pending.delete(id);
        resolve(value);
      };
      pending.set(id, (r) => finish(r));
      timer = setTimer(() => finish("timeout"), timeoutMs);
      try {
        transport.send(encodeRequest(id, op, args), (error) => {
          if (error) finish("send_failed");
        });
      } catch {
        finish("send_failed");
      }
    });
  }

  function unavailableText(): string {
    try {
      const installed = options.installed();
      if (installed.status === "missing") return TEXT_NOT_INSTALLED;
      if (installed.status === "outdated") return TEXT_OUTDATED;
    } catch {
      // cannot tell: fall through
    }
    return TEXT_NOT_RUNNING;
  }

  async function hello(): Promise<BridgeResult<HelloInfo>> {
    const answer = await exchange("hello", {});
    if (answer === "timeout" || answer === "send_failed") return fail(5, unavailableText());
    if (!answer.ok) return fail(5, answer.text);
    const info = parseHello(answer.value);
    if (!info) return fail(5, "bad hello reply from the Remote Script; " + TEXT_OUTDATED);
    if (info.v !== PROTOCOL_VERSION) return fail(5, `${TEXT_OUTDATED} (script protocol ${info.v}, extension ${PROTOCOL_VERSION})`);
    return { ok: true, value: info };
  }

  // Local functions, so a caller may take `request` off the object (ports).
  function available(): Promise<BridgeResult<HelloInfo>> {
    if (cached?.ok) return Promise.resolve(cached);
    if (!helloInFlight) {
      helloInFlight = hello()
        .catch((): BridgeResult<HelloInfo> => fail(5, TEXT_NOT_RUNNING))
        .then((r) => {
          cached = r;
          helloInFlight = null;
          return r;
        });
    }
    return helloInFlight;
  }

  async function ping(): Promise<BridgeResult<HelloInfo>> {
    let r: BridgeResult<HelloInfo>;
    try {
      r = await hello();
    } catch {
      r = fail(5, TEXT_NOT_RUNNING);
    }
    cached = r;
    return r;
  }

  /** The request args, with the access token added when the op needs one. */
  function prepare(args: Record<string, unknown>, wantToken: boolean | undefined): BridgeResult<Record<string, unknown>> {
    if (!wantToken) return { ok: true, value: args };
    if (!options.token) return fail(5, TEXT_NO_TOKEN);
    const token = options.token.get();
    if (!token.ok) return token;
    return { ok: true, value: { ...args, token: token.value } };
  }

  async function request(
    op: string,
    args: Record<string, unknown> = {},
    opts: { changes?: boolean; token?: boolean } = {},
  ): Promise<BridgeResult<Record<string, unknown>>> {
    try {
      const ready = await available();
      if (!ready.ok) return ready;
      if (!ready.value.ops.includes(op)) return fail(5, TEXT_OUTDATED);
      const first = prepare(args, opts.token);
      if (!first.ok) return first;
      let answer = await exchange(op, first.value);
      if (opts.token && answer !== "timeout" && answer !== "send_failed" && !answer.ok && answer.text === TEXT_FORBIDDEN) {
        // The script restarted (a new token per Live start): read the file again, once.
        options.token?.forget();
        const again = prepare(args, true);
        if (!again.ok) return again;
        answer = await exchange(op, again.value);
      }
      if (answer === "send_failed") return fail(1, "could not send to the Remote Script; nothing changed");
      if (answer === "timeout") {
        cached = null; // the script may have been reloaded: ask again next time
        return fail(1, opts.changes ? `${TEXT_NO_ANSWER}; the result of the change is unknown` : TEXT_NO_ANSWER);
      }
      return answer;
    } catch {
      return fail(1, TEXT_NO_ANSWER);
    }
  }

  return {
    state() {
      if (!cached) return "unknown";
      return cached.ok ? "available" : "unavailable";
    },
    available,
    ping,
    request,
    close() {
      closed = true;
      for (const settle of pending.values()) settle(fail(1, "bridge closed"));
      pending.clear();
      transport.close();
    },
  };
}

/** The real transport: one UDP socket on an ephemeral port, created on first use. */
export function createUdpTransport(): Transport {
  let socket: dgram.Socket | null = null;
  let listener: ((data: string) => void) | null = null;

  function open(): dgram.Socket {
    if (socket) return socket;
    const s = dgram.createSocket("udp4");
    s.on("message", (buf, rinfo) => {
      // Only the Remote Script may answer; another local process is dropped.
      if (rinfo.address !== BRIDGE_HOST || rinfo.port !== BRIDGE_PORT) return;
      listener?.(buf.toString("utf8"));
    });
    s.on("error", () => {
      // A failed socket is dropped; the next send creates a new one.
      try {
        s.close();
      } catch {
        /* already closed */
      }
      if (socket === s) socket = null;
    });
    s.unref();
    s.bind(0, BRIDGE_HOST);
    socket = s;
    return s;
  }

  return {
    send(data, done) {
      try {
        open().send(Buffer.from(data), BRIDGE_PORT, BRIDGE_HOST, (e) => done(e ?? null));
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    },
    onMessage(l) {
      listener = l;
    },
    close() {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}
