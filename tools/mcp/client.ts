import * as fs from "node:fs";
import { runTokenFilePath } from "../../src/devRoutes.js";

// The HTTP side of the cmdAbl MCP server (plan 0016): talks to the running development build on
// 127.0.0.1:27184. Every method answers text for an agent and never throws or hangs; "cmdAbl is
// not running" and "busy" are answers, not failures. The token is read from the file the
// extension wrote at startup; its value goes only into the Authorization header of a request to
// the local extension, never into a returned text or an error.

export const DEFAULT_PORT = 27184;
/** The route times out at 10 s; wait a little longer so its own 504 arrives first. */
export const REQUEST_TIMEOUT_MS = 12_000;

const NOT_RUNNING = "cmdAbl is not running (start it with npm start, in a development build)";

/** What a tool answers: readable text; `isError` only when the call could not be made or was refused (not for a command's non-zero exit code). */
export interface ToolText {
  text: string;
  isError: boolean;
}

export interface ClientOptions {
  port?: number;
  tokenFile?: string;
  readFile?: (file: string) => string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const ok = (text: string): ToolText => ({ text, isError: false });
const bad = (text: string): ToolText => ({ text, isError: true });

interface Outcome {
  code?: number;
  message?: string;
  log?: string[];
  dialogs?: string[];
  notices?: string[];
  ms?: number;
}

/** The outcome as text: exit code first, then message, dialogs, notices and the run's log lines. */
export function outcomeText(o: Outcome): string {
  const lines = [`exit ${o.code ?? "?"}${typeof o.ms === "number" ? ` (${o.ms} ms)` : ""}`];
  if (o.message) lines.push(o.message);
  if (o.dialogs?.length) lines.push("a dialog was needed (none was opened):", ...o.dialogs.map((d) => `  ${d}`));
  if (o.notices?.length) lines.push("shown to the user:", ...o.notices.map((n) => `  ${n}`));
  if (o.log?.length) lines.push("log:", ...o.log.map((l) => `  ${l}`));
  return lines.join("\n");
}

export function createClient(options: ClientOptions = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const tokenFile = options.tokenFile ?? runTokenFilePath();
  const read = options.readFile ?? ((file: string) => fs.readFileSync(file, "utf8"));
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const base = `http://127.0.0.1:${port}`;

  /** Read each time: the extension writes a new token at every start. */
  function token(): string | null {
    try {
      const value = read(tokenFile).trim();
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }

  async function call(method: string, route: string, opts: { auth?: boolean; body?: unknown } = {}): Promise<{ status: number; text: string } | ToolText> {
    const headers: Record<string, string> = {};
    if (opts.auth) {
      const value = token();
      if (value === null) {
        return bad(`no run-token file: ${NOT_RUNNING}. (cmdAbl writes the file at startup; a production build has no test routes.)`);
      }
      headers.Authorization = `Bearer ${value}`;
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const res = await doFetch(`${base}${route}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, text: await res.text() };
    } catch (e: unknown) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") return bad(`cmdAbl did not answer within ${Math.round(timeoutMs / 1000)} s (it may be busy or stuck; try cmdabl_state)`);
      return bad(`${NOT_RUNNING}. Nothing is listening on port ${port}.`);
    }
  }

  const parse = (text: string): any => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  /** Statuses the routes answer besides 200, as text. */
  function refusal(status: number, text: string): ToolText | null {
    const r = refusalText(status, text);
    return r ? { ...r, text: `HTTP ${status}: ${r.text}` } : null;
  }

  function refusalText(status: number, text: string): ToolText | null {
    const body = parse(text);
    if (status === 200) return null;
    if (status === 401) return bad("cmdAbl refused the token (it changes at every start; the file was re-read, so cmdAbl may have restarted: try again).");
    if (status === 403) return bad("refused: the request looked like it came from a web page.");
    if (status === 404) return bad("this cmdAbl build has no test routes (a production build, an older development build, or the route failed): run npm start.");
    if (status === 409) return bad(`busy: ${body?.reason ?? "another run is going or the user has a palette or dialog open"}. Try again in a moment.`);
    if (status === 504) return bad(`${body?.reason ?? "the run took too long"}. Check cmdabl_log before running more.`);
    return bad(`cmdAbl answered${body?.error ? `: ${body.error}` : ""}`);
  }

  return {
    async run(line: string): Promise<ToolText> {
      const res = await call("POST", "/run", { auth: true, body: { line } });
      if ("isError" in res) return res;
      const refused = refusal(res.status, res.text);
      if (refused) return refused;
      const body = parse(res.text);
      return body ? ok(outcomeText(body)) : bad("cmdAbl answered something unreadable");
    },
    async show(line: string): Promise<ToolText> {
      const res = await call("POST", "/show", { auth: true, body: { line } });
      if ("isError" in res) return res;
      const refused = refusal(res.status, res.text);
      if (refused) return refused;
      return ok(
        line.trim() === ""
          ? "started: the palette is opening in Live. Use cmdabl_capture to see it, cmdabl_keys to type."
          : "started: the line is running interactively in Live. Use cmdabl_capture to see it, cmdabl_keys to answer it.",
      );
    },
    async log(n = 50): Promise<ToolText> {
      const count = Math.max(1, Math.min(500, Math.floor(Number.isFinite(n) ? n : 50)));
      const res = await call("GET", `/log?n=${count}`, { auth: true });
      if ("isError" in res) return res;
      const refused = refusal(res.status, res.text);
      if (refused) return refused;
      const lines: unknown = parse(res.text)?.lines;
      return Array.isArray(lines) ? ok(lines.length ? lines.join("\n") : "(the log is empty)") : bad("cmdAbl answered something unreadable");
    },
    async bridge(): Promise<ToolText> {
      const res = await call("GET", "/bridge");
      if ("isError" in res) return res;
      return res.status === 200 ? ok(res.text) : bad(`cmdAbl answered ${res.status}: ${res.text}`);
    },
    async state(): Promise<ToolText> {
      const res = await call("GET", "/state");
      if ("isError" in res) return res;
      if (res.status !== 200) return bad(`cmdAbl answered ${res.status}`);
      return ok(res.text === "open" ? "open: a palette or dialog is open (the user is working; runs answer busy)" : "closed: no dialog is open (runs are possible)");
    },
  };
}
