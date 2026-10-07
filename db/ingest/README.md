# db/ingest

City-agnostic ingestion pipeline — see [`config/example-city.env`](config/example-city.env)
for the general shape of a run and where to get each input. This file documents
the **actual, real run** done for this project's demo city, Bellingham, WA
(`DEFAULT_REGION=bellingham-wa` in `.env`), including a real bug it found.

## What was actually run (Session 17 + 18)

1. **Full Washington state OSM extract**, downloaded once from Geofabrik:
   ```bash
   curl -o data/washington-latest.osm.pbf \
     https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf
   ```
   Geofabrik doesn't offer city-level extracts (state is the smallest unit),
   and BBBike's city-level catalog doesn't include Bellingham — its custom
   extract service (`extract.bbbike.org`) needs an interactive job
   submission (bbox + email, async delivery), not a scriptable single
   request. Rather than skip real-data verification or block on that, the
   full state extract was ingested for real once (Session 17 — 49.6M nodes,
   5.28M ways, ~50s) under region `washington-wa`, which doubled as a
   real stress-test of the pipeline at full scale.

2. **Full Washington TIGER 2023 block-group shapefile**, downloaded once
   from the Census Bureau:
   ```bash
   curl -o data/tl_2023_53_bg.zip \
     https://www2.census.gov/geo/tiger/TIGER2023/BG/tl_2023_53_bg.zip
   unzip data/tl_2023_53_bg.zip -d data/
   ```

3. **The actual Bellingham demo dataset was carved out of that already-ingested
   state-wide data**, not from a separate city-specific download, via a real
   run of the full orchestrator:
   ```bash
   ./db/ingest/ingest.sh --region bellingham-wa \
     --pbf ./data/washington-latest.osm.pbf \
     --tiger-shp ./data/tl_2023_53_bg.shp \
     --db-url "$DATABASE_URL"
   ```
   This works cleanly because `osm_pois.id`/`census_block_groups.geoid` are
   each a single, region-independent primary key: re-running the full-state
   ingest tagged as a new region (`bellingham-wa`) only actually inserts the
   rows whose ids don't already belong to `washington-wa` — in practice,
   whichever POIs/block groups had previously been re-tagged into
   `bellingham-wa` by a one-off bounding-box `UPDATE`
   (`ST_MakeEnvelope(-122.55, 48.68, -122.40, 48.82, 4326)`, chosen by
   checking real POI/block-group density in that box first). End state:
   6,270 POIs and 64 block groups under `bellingham-wa`, 276,503 POIs and
   5,247 block groups still under `washington-wa` — both real, both queryable,
   non-overlapping by id.

## Real bug found running this for real (Session 18)

`census/load_tiger.sh`'s merge step had no `ON CONFLICT` handling, unlike
`osm/load_osm.sh`'s (which already had `ON CONFLICT (id) DO NOTHING`). The
very first time two regions' real data actually overlapped in `geoid` space
(exactly the scenario above), the `INSERT` crashed with a duplicate-key
error — and because the `DELETE` and `INSERT` weren't wrapped in a
transaction, the `DELETE` had already committed, silently dropping that
region's existing 64 rows before the crash. Fixed by adding
`ON CONFLICT (geoid) DO NOTHING` and wrapping the whole merge in an explicit
`BEGIN`/`COMMIT` (also applied to `load_osm.sh`'s merge for the same
partial-failure safety, even though it wasn't hit there). Re-running
afterward correctly restored all 64 rows.

## Not done yet: real ACS demographics

`census/join_acs.py` is unit-logic-sound (argument/CSV parsing, the
GEOID-matched `UPDATE`) but has never been run against a real ACS export —
the Census Bureau's public API now requires a free API key
(`https://api.census.gov/data/key_signup.html`) even for small anonymous
requests, which it didn't used to, and getting one wasn't done this session.
Both regions' block groups currently have `NULL` population/median_income/
housing_units. To fill them in for real:
```bash
curl "https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E,B25001_001E&for=block%20group:*&in=state:53+county:073&key=YOUR_KEY" \
  > /tmp/whatcom_acs.json
# reshape into a CSV with headers: GEOID,population,median_income,housing_units
python3 db/ingest/census/join_acs.py --region bellingham-wa \
  --acs-csv /tmp/whatcom_acs_reshaped.csv --db-url "$DATABASE_URL"
```
