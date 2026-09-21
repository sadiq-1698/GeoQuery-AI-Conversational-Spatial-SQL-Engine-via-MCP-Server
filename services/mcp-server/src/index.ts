import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Importing db (rather than just its side effect) validates MCP_DATABASE_URL
// and fails fast on startup if it's missing, before the server ever attaches
// to a transport.
import { db } from "./db.js";
import {
  isochroneQueryInputSchema,
  postgisRawSqlInputSchema,
  spatialBufferInputSchema,
} from "./schemas/toolSchemas.js";
import { createIsochroneQueryHandler } from "./tools/isochroneQuery.js";
import { createPostgisRawSqlHandler } from "./tools/postgisRawSql.js";
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

server.registerTool(
  "isochrone_query",
  {
    title: "Reachability isochrone (approximate)",
    description:
      "Find what's reachable within a travel-time budget of a location: " +
      "returns an approximate reachable-area polygon plus POIs and census " +
      "block groups inside it, as a GeoJSON FeatureCollection. IMPORTANT: " +
      "this is a straight-line distance approximation based on an assumed " +
      "walking/driving speed, NOT routed travel time from a real road/path " +
      "network — always tell the user this is approximate, not exact.",
    inputSchema: isochroneQueryInputSchema,
  },
  createIsochroneQueryHandler(db),
);

server.registerTool(
  "postgis_raw_sql",
  {
    title: "Raw read-only SQL (escape hatch)",
    description:
      "Run a read-only SQL SELECT (a leading WITH CTE is fine) against " +
      "osm_pois and/or census_block_groups for questions spatial_buffer " +
      "and isochrone_query can't express (e.g. 'which block group has the " +
      "highest hospital density'). PREFER spatial_buffer or isochrone_query " +
      "when either fits the question — only use this for genuine ad-hoc " +
      "analysis. Must be a single statement; no DDL/DML, comments, or " +
      "tables outside osm_pois/census_block_groups. Use $1, $2, ... " +
      "placeholders with the params array rather than inlining values. " +
      "Results are capped at 200 rows.",
    inputSchema: postgisRawSqlInputSchema,
  },
  createPostgisRawSqlHandler(db),
);

const transport = new StdioServerTransport();
await server.connect(transport);
