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
- **`isochrone_query`** — registered and working. Approximates "what's
  reachable within N minutes" as a straight-line buffer (walking ~4.5 km/h,
  driving ~30 km/h) — **not routed travel time**; both the tool description
  and the returned polygon's properties say so explicitly. Returns the
  buffer polygon plus intersecting POIs and census block-group centroids
  in one GeoJSON `FeatureCollection`. A real network-routed version
  (pgRouting) would only need to change this tool's SQL, not its
  input/output shape.
- **`postgis_raw_sql`** — registered and working. Escape hatch for ad-hoc
  questions the two structured tools can't express, with defense-in-depth
  validation in `src/sql/allowlist.ts`: single statement only, `SELECT`
  (optionally a leading `WITH` CTE), a keyword blacklist scanned across the
  *whole* string (so a CTE can't hide a write), and a table allowlist
  (`osm_pois`/`census_block_groups` only, `public.`-qualified and CTE
  aliases both recognized). Missing `LIMIT` gets `200` appended; the
  handler also truncates results to 200 rows regardless. Runs only through
  the `geoquery_ro` pool, with an 8s client-side timeout on top of that
  role's own 5s `statement_timeout`. This is a regex-based guard, not a
  full SQL parser — documented as a known limitation in the file itself,
  layered *under* the DB role's own enforcement, not the only line of
  defense. Verified with a 31-case battery of malicious/benign SQL (see
  commit history) — formal unit tests land in Session 8.

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

This opens a local web UI to list tools and call any of the three with
real arguments against your database.
