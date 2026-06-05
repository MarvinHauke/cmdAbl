import * as http from "node:http";

export function startTriggerServer(port: number, onTrigger: () => void, getIsOpen: () => boolean): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/open") {
      onTrigger();
      res.writeHead(200).end("ok");
    } else if (req.url === "/state") {
      res.writeHead(200).end(getIsOpen() ? "open" : "closed");
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
