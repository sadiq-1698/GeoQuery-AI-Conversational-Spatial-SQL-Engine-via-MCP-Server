#!/bin/bash
# Loads OSM POIs from a .osm.pbf extract into osm_pois, tagged with --region.
# Idempotent: deletes existing rows for the region first, so re-running with
# a refreshed extract doesn't duplicate or leave stale rows behind.
set -euo pipefail

REGION=""
PBF=""
DB_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --pbf) PBF="$2"; shift 2 ;;
    --db-url) DB_URL="$2"; shift 2 ;;
    *) echo "error: unknown argument: $1" >&2; exit 1 ;;
  esac
done

: "${REGION:?--region is required}"
: "${PBF:?--pbf is required}"
: "${DB_URL:?--db-url is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v osm2pgsql >/dev/null 2>&1; then
  cat >&2 <<EOF
error: osm2pgsql is not installed.

Install it (e.g. 'apt install osm2pgsql' or 'brew install osm2pgsql') and
re-run. If you can't install it on this machine, an ogr2ogr-based fallback
is documented in db/README.md (loads points only, no tag-transform).
EOF
  exit 1
fi

echo "Deleting existing osm_pois rows for region '$REGION' (idempotent re-import)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM osm_pois WHERE region = '$REGION';"

echo "Running osm2pgsql (flex output, tagtransform.lua)..."
GEOQUERY_REGION="$REGION" osm2pgsql \
  --create \
  --output=flex \
  --style="$SCRIPT_DIR/tagtransform.lua" \
  --slim \
  --drop \
  --cache 1000 \
  -d "$DB_URL" \
  "$PBF"
