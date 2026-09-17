import type { Point, Polygon } from "geojson";
import type { z } from "zod";

import type { Database } from "../db.js";
import {
  ISOCHRONE_BLOCK_GROUPS_SQL,
  ISOCHRONE_BUFFER_SQL,
  ISOCHRONE_POIS_SQL,
  isochroneParams,
} from "../sql/queries.js";
import type { isochroneQueryInputSchema } from "../schemas/toolSchemas.js";

type IsochroneQueryInput = {
  [K in keyof typeof isochroneQueryInputSchema]: z.infer<
    (typeof isochroneQueryInputSchema)[K]
  >;
};

/**
 * Straight-line distance approximation, NOT routed travel time — a
 * deliberate scope tradeoff (see the plan/README): real network-distance
 * isochrones need pgRouting and a routable road graph, which is significant
 * extra ingestion complexity for a demo whose point is the MCP/agent
 * architecture, not routing fidelity. Speeds are rough averages (walking
 * ~4.5 km/h; driving ~30 km/h to account for urban stops/turns, not highway
 * speed). Swapping in pgRouting later only touches this file's SQL, not the
 * tool's input/output shape.
 */
const SPEED_METERS_PER_SECOND: Record<"walk" | "drive", number> = {
  walk: 1.25,
  drive: 8.33,
};

interface PoiRow {
  id: string;
  name: string | null;
  category: string;
  amenity: string | null;
  geometry: Point;
}

interface BlockGroupRow {
  geoid: string;
  population: number | null;
  median_income: number | null;
  housing_units: number | null;
  geometry: Point;
}

export function createIsochroneQueryHandler(db: Database) {
  return async (input: IsochroneQueryInput) => {
    const radiusMeters = input.minutes * 60 * SPEED_METERS_PER_SECOND[input.mode];
    const params = isochroneParams({
      center_lon: input.center_lon,
      center_lat: input.center_lat,
      radius_meters: radiusMeters,
      region: input.region,
    });

    const [bufferResult, poisResult, blockGroupsResult] = await Promise.all([
      db.query<{ geometry: Polygon }>(ISOCHRONE_BUFFER_SQL, params.slice(0, 3)),
      db.query<PoiRow>(ISOCHRONE_POIS_SQL, params),
      db.query<BlockGroupRow>(ISOCHRONE_BLOCK_GROUPS_SQL, params),
    ]);

    const isochroneFeature = {
      type: "Feature" as const,
      geometry: bufferResult.rows[0]!.geometry,
      properties: {
        kind: "isochrone" as const,
        minutes: input.minutes,
        mode: input.mode,
        radius_meters: radiusMeters,
        approximation:
          "Straight-line distance buffer, not routed travel time — actual " +
          "reachable area on foot or by road will differ, especially near " +
          "barriers like water, highways, or a sparse street grid.",
      },
    };

    const poiFeatures = poisResult.rows.map((row) => ({
      type: "Feature" as const,
      geometry: row.geometry,
      properties: {
        kind: "poi" as const,
        id: row.id,
        name: row.name,
        category: row.category,
        amenity: row.amenity,
      },
    }));

    const blockGroupFeatures = blockGroupsResult.rows.map((row) => ({
      type: "Feature" as const,
      geometry: row.geometry,
      properties: {
        kind: "block_group_centroid" as const,
        geoid: row.geoid,
        population: row.population,
        median_income: row.median_income,
        housing_units: row.housing_units,
      },
    }));

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: [isochroneFeature, ...poiFeatures, ...blockGroupFeatures],
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
