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

This project is being built incrementally across a series of sessions. See the
sections below as they're filled in; this README will grow into a full setup guide.

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

The MCP server (`services/mcp-server`) can be built and run standalone
already — see [its README](services/mcp-server/README.md) for how to test its
`spatial_buffer` tool manually with the MCP Inspector. Two more tools
(`isochrone_query`, `postgis_raw_sql`) land over the next couple of
sessions. The Next.js app (`apps/web`) that spawns it as a child process is
still to come.

## Verified vs. user-verified

Some parts of this project (Docker provisioning, real OSM/Census data ingestion,
live end-to-end chat queries) require a local machine with Docker and downloaded
data extracts, and can't be verified in a sandboxed dev environment.

- **Verified so far**: shell script syntax (`bash -n`) for all `.sh` files;
  Python syntax (`py_compile`) for `join_acs.py`; SQL DDL reviewed against
  PostGIS/Postgres documentation; `services/mcp-server` actually builds and
  runs — confirmed fail-fast behavior on missing config, and used a real MCP
  client to confirm `spatial_buffer`'s Zod schema converts to JSON Schema
  correctly over the wire and that calling it against an unreachable
  Postgres fails cleanly as an `isError` result rather than crashing.
- **Not verified — needs your machine**: `docker compose up` actually
  provisioning PostGIS; `osm2pgsql`/`ogr2ogr` runs against real data (the
  Lua flex tag-transform script in particular — its API varies across
  osm2pgsql versions and hasn't been run against a live import); the ACS
  join's SQL against real rows; an actual `spatial_buffer` call against
  real, ingested data (does `ST_DWithin` return the right POIs, does the
  GIST index actually get used — check with `EXPLAIN ANALYZE`); and the
  end-to-end chat → MCP → PostGIS query flow once those pieces exist.
