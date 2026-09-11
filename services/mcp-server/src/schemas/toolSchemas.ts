import { z } from "zod";

/**
 * Input shapes for the three MCP tools this server exposes. Defined here,
 * up front, as the single source of truth — handlers (added in later
 * sessions, see src/tools/) import these directly rather than redeclaring
 * validation, and apps/web's Anthropic tool mapping consumes the same shapes
 * indirectly via the server's listTools() response.
 *
 * These are Zod "raw shapes" (plain objects of ZodType values), which is
 * what McpServer.registerTool()'s `inputSchema` config expects — the SDK
 * converts them to JSON Schema internally for the wire protocol, which is
 * also the format Anthropic's `tools` API parameter expects, so the
 * conversion on the apps/web side ends up being a near-1:1 passthrough.
 */

export const POI_CATEGORIES = [
  "hospital",
  "school",
  "restaurant",
  "cafe",
  "park",
  "transit_stop",
  "shop",
  "other",
] as const;

export const spatialBufferInputSchema = {
  center_lon: z
    .number()
    .min(-180)
    .max(180)
    .describe("Longitude of the search center point"),
  center_lat: z
    .number()
    .min(-90)
    .max(90)
    .describe("Latitude of the search center point"),
  radius_meters: z
    .number()
    .min(1)
    .max(50_000)
    .describe("Search radius in meters (max 50km)"),
  category: z
    .enum(POI_CATEGORIES)
    .optional()
    .describe("Restrict results to one POI category; omit to search all categories"),
  region: z
    .string()
    .min(1)
    .describe('Region label to scope the search to, e.g. "seattle-wa"'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum number of results to return"),
};

export const isochroneQueryInputSchema = {
  center_lon: z
    .number()
    .min(-180)
    .max(180)
    .describe("Longitude of the search center point"),
  center_lat: z
    .number()
    .min(-90)
    .max(90)
    .describe("Latitude of the search center point"),
  minutes: z
    .number()
    .min(1)
    .max(60)
    .describe("Travel time budget in minutes"),
  mode: z
    .enum(["walk", "drive"])
    .default("walk")
    .describe(
      "Travel mode used for the straight-line distance approximation. " +
        "This is NOT routed travel time — see tool description.",
    ),
  region: z
    .string()
    .min(1)
    .describe('Region label to scope the search to, e.g. "seattle-wa"'),
};

export const postgisRawSqlInputSchema = {
  sql: z
    .string()
    .min(1)
    .describe(
      "A single read-only SELECT statement against osm_pois and/or " +
        "census_block_groups. No DDL/DML, no multiple statements, no comments. " +
        "Use $1, $2, ... placeholders with the `params` array instead of inlining values.",
    ),
  params: z
    .array(z.unknown())
    .optional()
    .describe("Positional parameters referenced as $1, $2, ... in sql"),
};
