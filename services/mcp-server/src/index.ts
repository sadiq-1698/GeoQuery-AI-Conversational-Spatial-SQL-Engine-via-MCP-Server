import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Side-effect import: validates MCP_DATABASE_URL and fails fast on startup
// if it's missing, before the server ever attaches to a transport. Tools
// that actually query the database are registered in later sessions.
import "./db.js";

const server = new McpServer({
  name: "geoquery-mcp",
  version: "0.1.0",
});

// Tools (spatial_buffer, isochrone_query, postgis_raw_sql) are registered in
// later sessions once their handlers exist — see src/schemas/toolSchemas.ts
// for the input shapes already defined for them.

const transport = new StdioServerTransport();
await server.connect(transport);
