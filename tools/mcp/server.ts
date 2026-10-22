import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient, type ToolText } from "./client.js";

// The cmdAbl MCP server (plan 0016): four tools over the local test routes of a running
// development build. Read docs/feature-plans/0016-test-mcp.md.

type Client = ReturnType<typeof createClient>;

const reply = (t: ToolText) => ({ content: [{ type: "text" as const, text: t.text }], ...(t.isError ? { isError: true } : {}) });

export function createServer(client: Client = createClient()): McpServer {
  const server = new McpServer({ name: "cmdabl", version: "0.1.0" });
  server.registerTool(
    "cmdabl_run",
    {
      description:
        "Run one cmdAbl command line headless in the user's open Live Set (like typing it in the palette; one undo step). Answers the exit code (0 ok, 1 failure, 2 usage, 3 not found, 4 ambiguous with the candidates listed, 5 unavailable), the message, the log lines of the run and any dialog the command needed (none opens; it counts as cancelled). Only use it when the user said a test Set is open and Live is free. Answers busy while the user has a palette or dialog open or another run is going.",
      inputSchema: { line: z.string().describe('the command line, e.g. "vol -6 #drums"') },
    },
    async ({ line }) => reply(await client.run(line)),
  );
  server.registerTool(
    "cmdabl_log",
    {
      description: "The last n lines of cmdAbl's log (default 50, at most 500), newest last. Read-only.",
      inputSchema: { n: z.number().int().min(1).max(500).optional().describe("how many lines (default 50)") },
    },
    async ({ n }) => reply(await client.log(n)),
  );
  server.registerTool(
    "cmdabl_bridge",
    { description: "Is the Remote Script connected, and how fast does it answer (timed round trips). Read-only." },
    async () => reply(await client.bridge()),
  );
  server.registerTool(
    "cmdabl_state",
    { description: "Is a palette or dialog open in Live (then cmdabl_run answers busy), or is it free. Read-only." },
    async () => reply(await client.state()),
  );
  return server;
}
