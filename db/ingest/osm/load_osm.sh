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
# tagtransform.lua writes to its own disposable staging tables, never
# osm_pois directly, so --create (drop + recreate whatever this script
# defines) is always safe here even though osm_pois itself already exists
# with our own pre-provisioned schema — confirmed for real in Session 17
# that --create against a table flex *doesn't* own silently destroys it
# (replaced osm_pois's primary key + 3 indexes + import_batch default with
# a bare id/geom-index-only structure). Routing everything through staging
# tables sidesteps that regardless of which osm2pgsql version/flag
# semantics are in play.
GEOQUERY_REGION="$REGION" osm2pgsql \
  --create \
  --output=flex \
  --style="$SCRIPT_DIR/tagtransform.lua" \
  --slim \
  --drop \
  --cache 1000 \
  -d "$DB_URL" \
  "$PBF"

# Merges both staging tables into the real osm_pois:
#   - Nodes: geometry is already a correct Point, straight copy.
#   - Closed ways (e.g. a hospital building outline): osm2pgsql's flex Lua
#     API has no object:as_polygon()/as_point() method (confirmed against a
#     real osm2pgsql 1.6.0 install — introspecting a live way object showed
#     only get_bbox/grab_tag) and a way-ids table always auto-populates as a
#     LineString, never a polygon. Converting to a true polygon and taking
#     its centroid happens here in SQL instead.
#   - Way ids are negated: OSM node ids and way ids are separate namespaces
#     that can collide numerically, but osm_pois.id is one shared primary
#     key with no "source type" column — negating way-derived ids (node ids
#     are always positive) guarantees no collision, the same convention
#     classic osm2pgsql itself has long used.
echo "Merging staged nodes and closed-way centroids into osm_pois..."
# Wrapped in an explicit transaction so a failure partway (e.g. the second
# INSERT) can't leave the first INSERT's rows committed with the staging
# tables still undropped — see the equivalent fix in census/load_tiger.sh
# (Session 18) for a real case where exactly this kind of partial failure
# silently dropped a region's existing rows.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

INSERT INTO osm_pois (id, name, category, amenity, tags, region, geom)
SELECT id, name, category, amenity, tags, region, geom
FROM osm_pois_node_staging
ON CONFLICT (id) DO NOTHING;

INSERT INTO osm_pois (id, name, category, amenity, tags, region, geom)
SELECT -id, name, category, amenity, tags, region, ST_Centroid(ST_MakePolygon(geom))
FROM osm_pois_way_staging
WHERE ST_IsClosed(geom) AND ST_NPoints(geom) >= 4
ON CONFLICT (id) DO NOTHING;

DROP TABLE osm_pois_node_staging;
DROP TABLE osm_pois_way_staging;

COMMIT;
SQL
