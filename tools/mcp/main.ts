import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// Entry point: `npm run mcp` (registered for agents in .mcp.json). stdout belongs to the protocol:
// nothing else may print there.

await createServer().connect(new StdioServerTransport());
