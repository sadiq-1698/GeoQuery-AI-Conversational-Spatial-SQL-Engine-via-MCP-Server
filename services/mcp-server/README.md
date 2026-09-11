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
- `src/index.ts` — creates the `McpServer` and connects the stdio transport.
  **No tools are registered yet** — `spatial_buffer`, `isochrone_query`, and
  `postgis_raw_sql` handlers land in the next few sessions (see the delivery
  plan), each importing its schema from `toolSchemas.ts`.
