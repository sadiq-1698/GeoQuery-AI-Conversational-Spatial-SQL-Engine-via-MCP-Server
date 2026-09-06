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

_Coming soon: Docker Compose instructions, ingestion steps, and running the app._

## Verified vs. user-verified

Some parts of this project (Docker provisioning, real OSM/Census data ingestion,
live end-to-end chat queries) require a local machine with Docker and downloaded
data extracts, and can't be verified in a sandboxed dev environment. This section
will track that split explicitly once those pieces exist.
