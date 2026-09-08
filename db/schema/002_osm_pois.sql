-- OpenStreetMap points of interest (hospitals, schools, restaurants, etc.).
--
-- City-agnostic by design: there is no city/region column tying this table's
-- structure to a specific place. `region` is a free-text label stamped by the
-- ingestion pipeline (db/ingest/) so multiple cities can coexist in the same
-- table, filtered per-query, without any schema change to add a new city.
CREATE TABLE IF NOT EXISTS osm_pois (
    id           BIGINT PRIMARY KEY,           -- OSM node/way id
    name         TEXT,
    -- Normalized category vocabulary the ingestion pipeline maps raw OSM tags
    -- into: hospital, school, restaurant, cafe, park, transit_stop, shop, other.
    category     TEXT NOT NULL,
    amenity      TEXT,                         -- raw OSM amenity/shop/tourism tag value
    tags         JSONB NOT NULL DEFAULT '{}',  -- full OSM tag bag for anything not promoted to a column
    region       TEXT NOT NULL,
    import_batch TIMESTAMPTZ NOT NULL DEFAULT now(),
    geom         GEOMETRY(Point, 4326) NOT NULL
);

-- Spatial index (GIST/R-Tree) — required for ST_DWithin/ST_Distance queries
-- in the spatial_buffer and isochrone_query MCP tools to avoid a full table scan.
CREATE INDEX IF NOT EXISTS osm_pois_geom_gix ON osm_pois USING GIST (geom);

CREATE INDEX IF NOT EXISTS osm_pois_category_ix ON osm_pois (category);
CREATE INDEX IF NOT EXISTS osm_pois_region_ix ON osm_pois (region);
CREATE INDEX IF NOT EXISTS osm_pois_tags_gin ON osm_pois USING GIN (tags);
