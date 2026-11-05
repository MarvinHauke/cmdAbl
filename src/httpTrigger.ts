import * as http from "node:http";
import { logger } from "./core/log.js";

const trigger = logger("trigger");

/** A web page (even an <img>) sends Origin or Sec-Fetch-Site; curl and the Karabiner rule send neither. */
export function fromBrowserPage(req: http.IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  return req.headers.origin !== undefined || (site !== undefined && site !== "none");
}

export function startTriggerServer(
  port: number,
  onTrigger: () => void,
  getIsOpen: () => boolean,
  /**
   * POST /reset: the documented recovery for the rare dialog hang (docs/limits.md); local only, not yet
   * exercised against a real hang. Returns a short description of what it did.
   */
  onReset: () => string = () => "not supported",
  /** GET /bridge: a diagnostic for measuring round trips — timed hellos to the Remote Script (min / median / max); answers a plain-text line. */
  onBridge: () => Promise<string> = async () => "not supported",
  /** Routes that exist only in development builds (src/devRoutes.ts): answers true when it handled the request. */
  extra?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean,
  /**
   * The live pages' routes (src/core/surfaces/livePage.ts). Also served on `[::1]:<port>` and ONLY these: the dialog's URL says
   * `localhost`, which macOS resolves to ::1 first, so cmdAbl must hold that address too — else any local process could
   * bind `[::1]:<port>` and receive the page's token. If someone else holds it, `listening()` is false (live pages fall
   * back to a data page).
   */
  liveOnly?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean,
  /**
   * GET /karabiner/cmdabl.json (plan 0021 §3): the Karabiner rule file, so the setup page's "Add rule" can hand Karabiner an
   * import link. Read-only, served on 127.0.0.1 only. Returns the file's text, or null when it cannot be read (404).
   */
  karabinerRule: () => string | null = () => null,
): { listening(): boolean; close(): void } {
  let v4 = false;
  // pending until the answer is in; none = this machine has no IPv6 (then nobody can hold ::1 either)
  let v6: "pending" | "ok" | "none" | "taken" = liveOnly ? "pending" : "ok";
  const server = http.createServer((req, res) => {
    if (extra?.(req, res) || liveOnly?.(req, res)) return;
    if (req.url === "/open") {
      onTrigger();
      res.writeHead(200).end("ok");
    } else if (req.url === "/karabiner/cmdabl.json") {
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET" }).end();
        return;
      }
      let text: string | null = null;
      try {
        text = karabinerRule();
      } catch (e: unknown) {
        trigger.error(`karabiner rule failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (text === null) res.writeHead(404).end();
      else res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) }).end(text);
    } else if (req.url === "/state") {
      res.writeHead(200).end(getIsOpen() ? "open" : "closed");
    } else if (req.url === "/bridge") {
      // Diagnostic for measuring round trips: time hellos while a modal dialog is
      // open. It opens no dialog and never throws.
      if (fromBrowserPage(req)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const fail = (e: unknown) => {
        trigger.error(`bridge check failed: ${e instanceof Error ? e.message : String(e)}`);
        try {
          res.writeHead(500).end("bridge check failed");
        } catch {
          // the response is already gone
        }
      };
      try {
        onBridge()
          .then((line) => void res.writeHead(200).end(line))
          .catch(fail);
      } catch (e: unknown) {
        fail(e);
      }
    } else if (req.url === "/reset") {
      // The supported recovery for a dialog that never closed (docs/limits.md): forgets
      // the open and queued dialogs so the next one opens a new modal.
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" }).end();
        return;
      }
      // A browser page can POST here without a preflight; curl sends no Origin.
      if (fromBrowserPage(req)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      try {
        res.writeHead(200).end(onReset());
      } catch (e: unknown) {
        trigger.error(`reset failed: ${e instanceof Error ? e.message : String(e)}`);
        res.writeHead(500).end("reset failed");
      }
    } else {
      res.writeHead(404).end();
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      trigger.error(`port ${port} already in use — trigger server not started`);
    } else {
      trigger.error(`trigger server error: ${err.message}`);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    v4 = true;
    trigger.info(`trigger server listening on http://127.0.0.1:${port}/open`);
  });
  let server6: http.Server | undefined;
  if (liveOnly) {
    server6 = http.createServer((req, res) => {
      if (!liveOnly(req, res)) res.writeHead(404).end();
    });
    server6.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT") {
        v6 = "none";
      } else {
        v6 = "taken";
        trigger.error(`[::1]:${port} is not available (${err.code ?? "error"}): live pages are off`);
      }
    });
    server6.listen(port, "::1", () => {
      v6 = "ok";
    });
  }
  // Live pages need both addresses: the one we serve everything on, and ::1 (or no IPv6 at all).
  return {
    listening: () => v4 && (v6 === "ok" || v6 === "none"),
    close: () => {
      server.close();
      server6?.close();
    },
  };
}
