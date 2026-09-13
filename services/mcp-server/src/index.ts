import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Importing db (rather than just its side effect) validates MCP_DATABASE_URL
// and fails fast on startup if it's missing, before the server ever attaches
// to a transport.
import { db } from "./db.js";
import { spatialBufferInputSchema } from "./schemas/toolSchemas.js";
import { createSpatialBufferHandler } from "./tools/spatialBuffer.js";

const server = new McpServer({
  name: "geoquery-mcp",
  version: "0.1.0",
});

server.registerTool(
  "spatial_buffer",
  {
    title: "Spatial buffer search",
    description:
      "Find OSM points of interest within a given radius of a location, " +
      "optionally filtered by category. Returns a GeoJSON FeatureCollection.",
    inputSchema: spatialBufferInputSchema,
  },
  createSpatialBufferHandler(db),
);

// isochrone_query and postgis_raw_sql are registered in the next two
// sessions once their handlers exist — see src/schemas/toolSchemas.ts for
// the input shapes already defined for them.

const transport = new StdioServerTransport();
await server.connect(transport);
