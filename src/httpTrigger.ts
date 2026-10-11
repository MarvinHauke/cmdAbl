import * as http from "node:http";

export function startTriggerServer(
  port: number,
  onTrigger: () => void,
  getIsOpen: () => boolean,
  /** POST /reset: manual diagnostic after a dialog hang; returns a short description of what it did. */
  onReset: () => string = () => "not supported",
): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/open") {
      onTrigger();
      res.writeHead(200).end("ok");
    } else if (req.url === "/state") {
      res.writeHead(200).end(getIsOpen() ? "open" : "closed");
    } else if (req.url === "/reset") {
      // Temporary diagnostic (see docs/feature-plans/STATUS.md, "Dialog hang").
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" }).end();
        return;
      }
      // A browser page can POST here without a preflight; curl sends no Origin.
      if (req.headers.origin !== undefined) {
        res.writeHead(403).end("forbidden");
        return;
      }
      try {
        res.writeHead(200).end(onReset());
      } catch (e: unknown) {
        console.error(`cmdAbl: reset failed: ${e instanceof Error ? e.message : String(e)}`);
        res.writeHead(500).end("reset failed");
      }
    } else {
      res.writeHead(404).end();
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`cmdAbl: port ${port} already in use — trigger server not started`);
    } else {
      console.error(`cmdAbl: trigger server error: ${err.message}`);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`cmdAbl: trigger server listening on http://127.0.0.1:${port}/open`);
  });
}
