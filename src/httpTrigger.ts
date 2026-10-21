import * as http from "node:http";
import { logger } from "./core/log.js";

const trigger = logger("trigger");

/** A web page (even an <img>) sends Origin or Sec-Fetch-Site; curl and the Karabiner rule send neither. */
function fromBrowserPage(req: http.IncomingMessage): boolean {
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
): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/open") {
      onTrigger();
      res.writeHead(200).end("ok");
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
    trigger.info(`trigger server listening on http://127.0.0.1:${port}/open`);
  });
}
