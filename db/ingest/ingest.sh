#!/bin/bash
# Orchestrates loading one region's OSM POIs and Census block groups into
# PostGIS. City-agnostic by design: every input is a flag, and nothing about
# a specific city is hardcoded here or in any script this calls — re-running
# for a different city is just different flag values.
set -euo pipefail

usage() {
  cat <<USAGE
Usage: $0 --region <label> --pbf <path> --tiger-shp <path> [--acs-csv <path>] [--db-url <url>]

  --region      Free-text label to tag all ingested rows with, e.g. "seattle-wa"
  --pbf         Path to an OSM .osm.pbf extract (e.g. from Geofabrik/BBBike)
  --tiger-shp   Path to a Census TIGER/Line block-group shapefile (.shp)
  --acs-csv     Optional ACS demographic CSV (see census/join_acs.py --help
                for the expected columns). Without it, block groups load with
                geometry only and NULL population/median_income/housing_units.
  --db-url      Postgres admin connection string. Defaults to \$DATABASE_URL.

See db/ingest/config/example-city.env for a filled-in example.
USAGE
  exit 1
}

REGION=""
PBF=""
TIGER_SHP=""
ACS_CSV=""
DB_URL="${DATABASE_URL:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --pbf) PBF="$2"; shift 2 ;;
    --tiger-shp) TIGER_SHP="$2"; shift 2 ;;
    --acs-csv) ACS_CSV="$2"; shift 2 ;;
    --db-url) DB_URL="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "error: unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$REGION" ] || { echo "error: --region is required" >&2; usage; }
[ -n "$PBF" ] || { echo "error: --pbf is required" >&2; usage; }
[ -n "$TIGER_SHP" ] || { echo "error: --tiger-shp is required" >&2; usage; }
[ -n "$DB_URL" ] || { echo "error: --db-url is required (or set DATABASE_URL)" >&2; usage; }
[ -f "$PBF" ] || { echo "error: PBF file not found: $PBF" >&2; exit 1; }
[ -f "$TIGER_SHP" ] || { echo "error: TIGER shapefile not found: $TIGER_SHP" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> [1/3] Loading OSM POIs for region '$REGION'"
"$SCRIPT_DIR/osm/load_osm.sh" --region "$REGION" --pbf "$PBF" --db-url "$DB_URL"

echo "==> [2/3] Loading Census block-group geometry for region '$REGION'"
"$SCRIPT_DIR/census/load_tiger.sh" --region "$REGION" --tiger-shp "$TIGER_SHP" --db-url "$DB_URL"

if [ -n "$ACS_CSV" ]; then
  echo "==> [3/3] Joining ACS demographics for region '$REGION'"
  python3 "$SCRIPT_DIR/census/join_acs.py" --region "$REGION" --acs-csv "$ACS_CSV" --db-url "$DB_URL"
else
  echo "==> [3/3] Skipped (no --acs-csv given) — demographic columns stay NULL for this region"
fi

echo "==> Done. Region '$REGION' ingested."
