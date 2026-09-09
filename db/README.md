# db

- **`schema/`** — PostGIS schema (extensions, `osm_pois`, `census_block_groups`,
  the read-only `geoquery_ro` role). Apply with Docker's auto-init on a fresh
  volume, or `./migrate.sh` against an existing database.
- **`ingest/`** — city-agnostic ingestion pipeline. `ingest.sh` orchestrates
  `osm/load_osm.sh` (OSM POIs via osm2pgsql flex output) and
  `census/load_tiger.sh` + `census/join_acs.py` (TIGER geometry + optional
  ACS demographics). See the root [README](../README.md#2-data-ingestion) for
  usage and [`ingest/config/example-city.env`](ingest/config/example-city.env)
  for where to get the input data.

See the root [README](../README.md) for full setup instructions.
