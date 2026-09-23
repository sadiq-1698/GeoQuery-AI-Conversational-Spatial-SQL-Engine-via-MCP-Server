# services/mcp-server

Node.js MCP server (`@modelcontextprotocol/sdk`, stdio transport) exposing
spatial-SQL tools (`spatial_buffer`, `isochrone_query`, `postgis_raw_sql`) against
a read-only PostGIS connection (`MCP_DATABASE_URL`, the `geoquery_ro` role —
never the admin credential).

```bash
npm install                 # from the repo root (npm workspaces)
npm run --workspace services/mcp-server typecheck
npm run --workspace services/mcp-server test        # no database needed — see "Testing" below
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
  defense. Covered by `test/sqlGuard.test.ts` below.

## Testing

`npm run --workspace services/mcp-server test` runs the full suite (48
tests) with **no database required** — everything is tested against
`test/mockDb.ts`, a `Database` implementation backed by a plain function
instead of `pg.Pool`, returning fixture rows and logging every call made
through it. This is the payoff of `src/db.ts`'s `Database` interface
(Session 4): every tool handler takes `db` as an argument rather than
importing the pool directly, so a mock is a drop-in substitute.

- `test/sqlGuard.test.ts` — 34 cases (10 accept, 21 reject, 3 for
  `LIMIT`-handling) for `validateReadOnlySql()`: stacked queries,
  comment-hidden payloads, CTE-disguised writes, `SELECT INTO`,
  disallowed/schema-qualified tables.
- `test/geojson.test.ts` — `spatial_buffer`/`isochrone_query` query-param
  construction and GeoJSON `FeatureCollection` assembly.
- `test/postgisRawSql.test.ts` — confirms a rejected query never reaches
  the database at all, valid queries pass params through unchanged, and
  the 200-row truncation guard.

Uses Node's built-in test runner (`node:test`, no extra dependency) via a
`pretest` step that compiles `src/` + `test/` together into `dist-test/`
(`tsconfig.test.json` — kept separate from the production
`tsconfig.json`/`dist/` so this doesn't affect what actually ships).

What this suite **can't** verify — it's all in-memory, so real SQL
correctness against actual PostGIS (does `ST_DWithin` return the right
rows, does the query planner use the GIST indexes) still needs your
machine; see the root README's verified-vs-user-verified checklist.

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
