import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient, type ToolText } from "./client.js";
import { KEYS, createDesktop, type Desktop } from "./desktop.js";

// The cmdAbl MCP server (plan 0016): four tools over the local test routes of a running
// development build. Read docs/feature-plans/0016-test-mcp.md.

type Client = ReturnType<typeof createClient>;

const reply = (t: ToolText) => ({ content: [{ type: "text" as const, text: t.text }], ...(t.isError ? { isError: true } : {}) });

export function createServer(client: Client = createClient(), desktop: Desktop = createDesktop()): McpServer {
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
  server.registerTool(
    "cmdabl_show",
    {
      description:
        'Start a cmdAbl line interactively in Live, as if typed in the palette: its dialogs really open (for screenshots and hand checks). Returns at once, without waiting for the dialog. An empty line opens the empty palette. Not added to the history. Answers busy while a dialog is open or a run is going. Close the dialog with cmdabl_keys (escape) when done.',
      inputSchema: { line: z.string().describe('the line, e.g. "tag -l"; empty opens the palette') },
    },
    async ({ line }) => reply(await client.show(line)),
  );
  server.registerTool(
    "cmdabl_keys",
    {
      description: `Bring Live to the front and type text and/or press one key there (through System Events). Allowed keys: ${Object.keys(KEYS).join(", ")}. Refuses when Live is not frontmost afterwards. Needs Accessibility for the terminal app.`,
      inputSchema: {
        text: z.string().max(200).optional().describe("printable text to type"),
        key: z.enum(Object.keys(KEYS) as [string, ...string[]]).optional().describe("one key to press after the text"),
      },
    },
    async ({ text, key }) => reply(await desktop.keys({ text, key })),
  );
  server.registerTool(
    "cmdabl_capture",
    {
      description:
        'Capture ONE Live window to captures/<name>.png (gitignored; never the full screen). target "dialog" is the frontmost smaller Live window (a cmdAbl dialog), "live" is Live\'s main window. Answers the path and size, or says no window matched and captures nothing. The image may show private names: it goes through the docs agent (opaque boxes) and the reviewer before it is committed.',
      inputSchema: {
        name: z.string().regex(/^[a-z0-9-]{1,60}$/).describe("file name without extension: a-z, 0-9 and - only"),
        target: z.enum(["dialog", "live"]),
      },
    },
    async ({ name, target }) => reply(await desktop.capture({ name, target })),
  );
  return server;
}
