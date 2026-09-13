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
