/**
 * Parameterized SQL for the structured (non-raw-SQL) tools. Query text is a
 * static string — only the values array varies per call — so params are
 * always passed through pg's parameterized query API, never interpolated.
 */

export interface SpatialBufferParams {
  center_lon: number;
  center_lat: number;
  radius_meters: number;
  category?: string;
  region: string;
  limit: number;
}

// ST_DWithin on the geography cast is what lets Postgres use the GIST index
// on osm_pois.geom (an index bounding-box check happens before the exact
// geography distance calc) instead of computing distance for every row.
export const SPATIAL_BUFFER_SQL = `
  SELECT
    id,
    name,
    category,
    amenity,
    ST_AsGeoJSON(geom)::json AS geometry,
    ST_Distance(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
    ) AS distance_m
  FROM osm_pois
  WHERE region = $5
    AND ($4::text IS NULL OR category = $4)
    AND ST_DWithin(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
  ORDER BY distance_m ASC
  LIMIT $6
`;

export function spatialBufferParams(input: SpatialBufferParams): unknown[] {
  return [
    input.center_lon,
    input.center_lat,
    input.radius_meters,
    input.category ?? null,
    input.region,
    input.limit,
  ];
}

export interface IsochroneParams {
  center_lon: number;
  center_lat: number;
  radius_meters: number;
  region: string;
}

// radius_meters here is already the straight-line approximation (minutes *
// speed), computed by the caller — see tools/isochroneQuery.ts.
export function isochroneParams(input: IsochroneParams): unknown[] {
  return [input.center_lon, input.center_lat, input.radius_meters, input.region];
}

// Returns just the buffer polygon. Takes only the first 3 positional params
// (lon, lat, radius) — Postgres errors on unused bind parameters, so callers
// must slice isochroneParams()'s 4-element array down to 3 for this query.
export const ISOCHRONE_BUFFER_SQL = `
  SELECT ST_AsGeoJSON(
    ST_Buffer(
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )::geometry
  )::json AS geometry
`;

// Same ST_DWithin/GIST-index pattern as SPATIAL_BUFFER_SQL, just without a
// category filter or distance ordering (an isochrone cares about "what's in
// range", not ranking by distance).
export const ISOCHRONE_POIS_SQL = `
  SELECT id, name, category, amenity, ST_AsGeoJSON(geom)::json AS geometry
  FROM osm_pois
  WHERE region = $4
    AND ST_DWithin(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
  LIMIT 500
`;

// Block groups are large polygons, so membership is a real ST_Intersects
// against the buffer polygon (not a distance-to-centroid check) — a block
// group whose edge pokes into the buffer counts, even if its centroid
// doesn't. The centroid is only used for the returned point representation.
export const ISOCHRONE_BLOCK_GROUPS_SQL = `
  SELECT geoid, population, median_income, housing_units,
         ST_AsGeoJSON(ST_Centroid(geom))::json AS geometry
  FROM census_block_groups
  WHERE region = $4
    AND ST_Intersects(
      geom,
      ST_Buffer(
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )::geometry
    )
  LIMIT 500
`;
