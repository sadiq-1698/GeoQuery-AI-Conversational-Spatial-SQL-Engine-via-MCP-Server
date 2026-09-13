import type { Point } from "geojson";
import type { z } from "zod";

import type { Database } from "../db.js";
import { SPATIAL_BUFFER_SQL, spatialBufferParams } from "../sql/queries.js";
import type { spatialBufferInputSchema } from "../schemas/toolSchemas.js";

type SpatialBufferInput = {
  [K in keyof typeof spatialBufferInputSchema]: z.infer<
    (typeof spatialBufferInputSchema)[K]
  >;
};

// pg parses BIGINT (osm_pois.id) as a string by default to avoid precision
// loss for values beyond Number.MAX_SAFE_INTEGER; kept as a string end to end
// rather than coerced back to a JS number.
interface SpatialBufferRow {
  id: string;
  name: string | null;
  category: string;
  amenity: string | null;
  geometry: Point;
  distance_m: number;
}

export function createSpatialBufferHandler(db: Database) {
  return async (input: SpatialBufferInput) => {
    const result = await db.query<SpatialBufferRow>(
      SPATIAL_BUFFER_SQL,
      spatialBufferParams(input),
    );

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: result.rows.map((row) => ({
        type: "Feature" as const,
        geometry: row.geometry,
        properties: {
          id: row.id,
          name: row.name,
          category: row.category,
          amenity: row.amenity,
          distance_m: row.distance_m,
        },
      })),
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(featureCollection),
        },
      ],
    };
  };
}
