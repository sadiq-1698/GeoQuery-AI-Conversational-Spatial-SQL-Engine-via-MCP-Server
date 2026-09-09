#!/bin/bash
# Loads a Census TIGER/Line block-group shapefile's geometry into
# census_block_groups, tagged with --region. Demographic columns
# (population/median_income/housing_units) stay NULL until join_acs.py runs.
#
# Idempotent: deletes existing rows for the region first, so re-running
# doesn't duplicate rows.
set -euo pipefail

REGION=""
TIGER_SHP=""
DB_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --tiger-shp) TIGER_SHP="$2"; shift 2 ;;
    --db-url) DB_URL="$2"; shift 2 ;;
    *) echo "error: unknown argument: $1" >&2; exit 1 ;;
  esac
done

: "${REGION:?--region is required}"
: "${TIGER_SHP:?--tiger-shp is required}"
: "${DB_URL:?--db-url is required}"

if ! command -v ogr2ogr >/dev/null 2>&1; then
  cat >&2 <<EOF
error: ogr2ogr is not installed.

Install GDAL (e.g. 'apt install gdal-bin' or 'brew install gdal') and re-run.
EOF
  exit 1
fi

echo "Loading TIGER shapefile into a staging table..."
# -overwrite replaces the staging table each run; it's a throwaway working
# table, dropped below once its rows are merged into census_block_groups.
ogr2ogr -f PostgreSQL "PG:$DB_URL" "$TIGER_SHP" \
  -nln census_block_groups_staging \
  -nlt MULTIPOLYGON \
  -t_srs EPSG:4326 \
  -lco GEOMETRY_NAME=geom \
  -overwrite

echo "Merging into census_block_groups for region '$REGION'..."
# Column names (statefp/countyfp/tractce/blkgrpce/geoid) match the standard
# TIGER/Line block-group shapefile schema with ogr2ogr's default field-name
# lowercasing. If your TIGER vintage differs, check with:
#   psql "$DB_URL" -c '\d census_block_groups_staging'
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
DELETE FROM census_block_groups WHERE region = '$REGION';

INSERT INTO census_block_groups (geoid, state_fp, county_fp, tract_ce, block_group, region, geom)
SELECT geoid, statefp, countyfp, tractce, blkgrpce, '$REGION', geom
FROM census_block_groups_staging;

DROP TABLE census_block_groups_staging;
SQL

echo "Loaded census_block_groups geometry for region '$REGION'."
