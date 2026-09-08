-- Census block-group polygons with a small set of ACS demographic attributes.
-- Same city-agnostic pattern as osm_pois: `region` is a free-text label, not
-- a foreign key, so re-running ingestion for a new city/state needs no
-- schema change here either.
CREATE TABLE IF NOT EXISTS census_block_groups (
    geoid         TEXT PRIMARY KEY,            -- 12-digit Census block-group GEOID
    state_fp      TEXT NOT NULL,
    county_fp     TEXT NOT NULL,
    tract_ce      TEXT NOT NULL,
    block_group   TEXT NOT NULL,
    population    INTEGER,                     -- ACS B01003_001E, nullable (not every extract joins ACS)
    median_income INTEGER,                     -- ACS B19013_001E
    housing_units INTEGER,                     -- ACS B25001_001E
    region        TEXT NOT NULL,
    import_batch  TIMESTAMPTZ NOT NULL DEFAULT now(),
    geom          GEOMETRY(MultiPolygon, 4326) NOT NULL
);

-- GIST index for containment/intersection queries (ST_Intersects, ST_Contains)
-- used when a tool checks which block group(s) a POI or isochrone falls within.
CREATE INDEX IF NOT EXISTS cbg_geom_gix ON census_block_groups USING GIST (geom);
CREATE INDEX IF NOT EXISTS cbg_region_ix ON census_block_groups (region);
