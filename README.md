# GeoQuery AI — Conversational Spatial SQL Engine via MCP Server

Ask questions in plain English ("hospitals within 2km of downtown Seattle") and get
live PostGIS query results rendered as GeoJSON on a map. A Claude agent, embedded in
a Next.js app, translates the question into tool calls against a custom Node.js
MCP server (`@modelcontextprotocol/sdk`) that executes validated spatial SQL.

## Architecture

- **`apps/web`** — Next.js (App Router) chat UI + MapLibre GL JS map. Hosts the
  Claude tool-use agent loop (`app/api/chat/route.ts`) that acts as an MCP client.
- **`services/mcp-server`** — Node MCP server exposing three tools: `spatial_buffer`,
  `isochrone_query`, and `postgis_raw_sql`, backed by a read-only Postgres role.
- **`db`** — PostGIS schema (OSM POIs + Census block groups) and a city-agnostic
  ingestion pipeline (flag-driven: `--region`, `--pbf`, `--tiger-shp`, `--acs-csv`).

## Status

The full pipeline is wired end to end: chat input in `apps/web` → `/api/chat`
→ the Claude agent loop → MCP tool calls against PostGIS → GeoJSON streamed
back → rendered on the map, with a toggle list to show/hide results from
earlier turns and popups on both point and polygon features. What's left
(Sessions 17+) is a real end-to-end run against your own data and
credentials, documentation, and a final pass — not new plumbing. See
[apps/web/README.md](apps/web/README.md) and
[services/mcp-server/README.md](services/mcp-server/README.md) for how each
half is built.

## Setup

### 1. Database

```bash
cp .env.example .env   # fill in POSTGRES_PASSWORD, MCP_RO_PASSWORD, ANTHROPIC_API_KEY
docker compose up -d
docker compose exec postgis pg_isready -U geoquery_admin -d geoquery   # wait for "accepting connections"
```

On a **fresh** volume, Docker auto-applies everything in `db/schema/` via
`docker-entrypoint-initdb.d` (extensions, tables, indexes, and the read-only
`geoquery_ro` role). If you're re-provisioning an existing database instead
(schema changes after the first run), apply them manually:

```bash
./db/migrate.sh
```

`migrate.sh` tracks applied migrations in a `schema_migrations` table, so
it's safe to run any time — it only applies files that haven't run yet.

> Re-running `docker compose up` does **not** re-apply `db/schema/` — those
> init scripts only fire on a brand-new volume. To wipe and start over:
> `docker compose down -v` (destroys all data). To apply new schema files
> without losing data, use `./db/migrate.sh` instead.

### 2. Data ingestion

City-agnostic and flag-driven — nothing about a specific city is hardcoded
in any ingestion script; see [`db/ingest/config/example-city.env`](db/ingest/config/example-city.env)
for where to download a PBF/TIGER shapefile/ACS CSV and what shape they need.

```bash
pip install -r db/ingest/requirements.txt   # needed for census/join_acs.py

./db/ingest/ingest.sh \
  --region seattle-wa \
  --pbf ./data/seattle.osm.pbf \
  --tiger-shp ./data/tl_2023_53_bg.shp \
  --acs-csv ./data/seattle_acs.csv \
  --db-url "$DATABASE_URL"
```

Requires `osm2pgsql` (OSM loading) and `ogr2ogr`/GDAL (TIGER shapefile
loading) installed locally. `--acs-csv` is optional — without it, block
groups load with geometry only and `NULL` demographic columns. Re-running
`ingest.sh` for the same `--region` is safe (each step deletes that region's
existing rows before re-inserting); re-running for a *different* `--region`
just adds more rows alongside it, so multiple cities can coexist.

### 3. Running the app

The MCP server (`services/mcp-server`) is feature-complete for this phase —
all three tools (`spatial_buffer`, `isochrone_query`, `postgis_raw_sql`) are
registered and can be built/run/tested standalone; see
[its README](services/mcp-server/README.md) for how to exercise them
manually with the MCP Inspector.

The Next.js app (`apps/web`) is now a real, working chat client — type a
question and it genuinely calls `/api/chat`, which runs the Claude agent
loop against the MCP server above:

```bash
npm run --workspace @geoquery/web dev   # http://localhost:3000
```

This needs your own `ANTHROPIC_API_KEY` in `.env` and a database with data
in it (steps 1-2 above) to produce real answers — without those, you'll see
real error messages in the chat (an auth error, or the model telling you it
has no data) rather than a crash, which is itself part of what's been
verified.

## Verified vs. user-verified

Some parts of this project (Docker provisioning, real OSM/Census data ingestion,
live end-to-end chat queries) require a local machine with Docker and downloaded
data extracts, and can't be verified in a sandboxed dev environment.

- **Verified so far**: shell script syntax (`bash -n`) for all `.sh` files;
  Python syntax (`py_compile`) for `join_acs.py`; SQL DDL reviewed against
  PostGIS/Postgres documentation; `services/mcp-server` actually builds and
  runs — confirmed fail-fast behavior on missing config, and used a real MCP
  client to confirm all three tools' Zod schemas convert to JSON Schema
  correctly over the wire and that DB-dependent calls fail cleanly as an
  `isError` result against an unreachable Postgres rather than crashing.
  `services/mcp-server` also has a real automated test suite now (48 tests,
  `npm run --workspace services/mcp-server test`, no database needed —
  see [its README](services/mcp-server/README.md#testing)): the
  `postgis_raw_sql` SQL guard's 34 cases (stacked queries, comment-hidden
  payloads, CTE-disguised writes, disallowed tables), and
  `spatial_buffer`/`isochrone_query`'s query-construction and GeoJSON
  assembly logic against a mocked database. `apps/web` is also verified with
  a real headless browser (Playwright driving system Chrome), not just
  typecheck/build/curl: the MapLibre map actually renders and fills its
  pane, attribution text is correct, clicking a point feature opens a popup
  with the right content while clicking a polygon doesn't, and (after
  finding and fixing a Turbopack/maplibre-gl worker-loading issue along the
  way — see `apps/web/README.md`) there are no console errors left besides
  an unrelated, pre-existing `favicon.ico` 404. `lib/mcp-client.ts` and
  `lib/anthropic-tools.ts` are verified against the real running MCP
  server (not mocked): a real spawn + connect, a second `getMcpClient()`
  call reusing the same client (confirmed by reference equality, not just
  "it didn't crash"), all three tools' schemas correctly mapped to
  Anthropic's shape, and a real `callTool()` round trip. `lib/agent-loop.ts`
  is verified the same way, minus the one piece needing a paid API key
  (none available in this sandbox): a minimal fake Anthropic client drives
  the loop through a tool_use turn then an end_turn turn while the MCP side
  is entirely real (actual server spawn, actual `callTool()`) — confirming
  the tool_result block is correctly threaded back into the next API call
  with the right `tool_use_id`/`is_error`/content, text deltas forward
  through the event callbacks, and the final message history is exactly
  what it should be. `app/api/chat/route.ts` is verified against a real dev
  server: all four request-validation failure cases return the correct
  400s, and a valid request returns the correct streaming headers and a
  genuine `authentication_error` from Anthropic's real API (no key
  available here) arrives as a clean `error` event rather than a crash —
  which also proves the MCP server spawn and `listTools()` succeeded first,
  since the loop only reaches the Anthropic call after that. Caught and
  fixed a real bug along the way: a NodeNext-style `.js` relative import
  habit carried over from `services/mcp-server` that typecheck accepted but
  Turbopack couldn't resolve, surfacing only once the file was actually
  built into a route. Finally, `ChatPanel` → `/api/chat` → `MapView` is
  verified as one real pipeline in a real browser: since no Anthropic key
  exists in this sandbox, the `/api/chat` network call itself was mocked
  (Playwright route interception) with a realistic ndjson stream, which
  still exercises all of the real client-side code (fetch, stream parsing,
  history reconciliation, map wiring) — confirmed the user bubble appears
  immediately, two assistant turns from one exchange render as separate
  bubbles once the authoritative `done` history lands (not merged, even
  though they're concatenated during live streaming), the mechanical
  tool_result message never renders as a chat bubble, a second turn resends
  the *full* prior history plus the new message (proving the stateless
  client-owns-history design actually works across turns, not just once),
  and a single-point GeoJSON result really does fly the map in and render
  the marker. The layer-toggle list and the new polygon popups are also
  verified in a real browser: clicking a polygon now shows a populated
  popup with a kind-aware heading and formatted values (previously nothing
  happened — an intentional change from Session 10's scope, not a
  regression), and — checked deterministically via a throwaway page
  exposing the map instance directly, rather than relying on real
  tile-loading timing in screenshots — unchecking a layer removes exactly
  that layer's source and rendered layer while a second, untouched layer is
  unaffected, and re-checking restores it.
- **Not verified — needs your machine**: `docker compose up` actually
  provisioning PostGIS; `osm2pgsql`/`ogr2ogr` runs against real data (the
  Lua flex tag-transform script in particular — its API varies across
  osm2pgsql versions and hasn't been run against a live import); the ACS
  join's SQL against real rows; actual `spatial_buffer`/`isochrone_query`
  calls against real, ingested data (do `ST_DWithin`/`ST_Intersects` return
  the right rows, do the GIST indexes actually get used — check with
  `EXPLAIN ANALYZE`); and — the one remaining gap now that every piece of
  the pipeline individually works — a real end-to-end run with an actual
  `ANTHROPIC_API_KEY` and real ingested data, asking a real question and
  getting a real model-reasoned answer with real GeoJSON on the map. Every
  piece of that chain has been verified in isolation (real MCP server, real
  Anthropic request shape and error handling, real streaming/map wiring);
  what's never happened is all of them firing together with real
  credentials and real rows.
