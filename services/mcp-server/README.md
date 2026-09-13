# services/mcp-server

Node.js MCP server (`@modelcontextprotocol/sdk`, stdio transport) exposing
spatial-SQL tools (`spatial_buffer`, `isochrone_query`, `postgis_raw_sql`) against
a read-only PostGIS connection (`MCP_DATABASE_URL`, the `geoquery_ro` role —
never the admin credential).

```bash
npm install                 # from the repo root (npm workspaces)
npm run --workspace services/mcp-server typecheck
npm run --workspace services/mcp-server build
MCP_DATABASE_URL=postgresql://geoquery_ro:...@localhost:5432/geoquery \
  npm run --workspace services/mcp-server start
```

## Status

- `src/db.ts` — read-only connection pool behind a small `Database` interface
  (mockable for tests), fails fast at startup if `MCP_DATABASE_URL` is unset.
- `src/schemas/toolSchemas.ts` — Zod input shapes for all three tools,
  defined up front.
- `src/sql/queries.ts` — parameterized SQL for the structured (non-raw-SQL)
  tools.
- **`spatial_buffer`** — registered and working. Finds OSM POIs within a
  radius of a point, optionally filtered by `category`, returned as a
  GeoJSON `FeatureCollection`.
- `isochrone_query` and `postgis_raw_sql` land in the next two sessions.

## Testing a tool manually

With a real database running (`docker compose up -d` + ingested data, see the
root README), you can call a tool directly without building the rest of the
app yet, using the official MCP Inspector:

```bash
npm run --workspace services/mcp-server build
npx @modelcontextprotocol/inspector \
  -e MCP_DATABASE_URL=postgresql://geoquery_ro:...@localhost:5432/geoquery \
  node services/mcp-server/dist/index.js
```

This opens a local web UI to list tools and call `spatial_buffer` with real
arguments against your database.
