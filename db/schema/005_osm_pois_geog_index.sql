-- osm_pois_geom_gix (a plain GIST index on the `geometry` column) is NOT
-- used by spatial_buffer's/isochrone_query's ST_DWithin(geom::geography, ...)
-- queries, confirmed by EXPLAIN ANALYZE against a real, fully-loaded
-- osm_pois table (282k rows, Session 17): the planner fell back to a
-- parallel sequential scan (~170ms) instead of the index, because the
-- index is built on `geometry` operators while the query's bounding-box
-- check is done in `geography` space. A functional GIST index on the
-- geography cast itself lets the planner use it (confirmed: ~9ms, same
-- query, 18x faster).
CREATE INDEX IF NOT EXISTS osm_pois_geom_geog_gix
  ON osm_pois USING GIST ((geom::geography));
