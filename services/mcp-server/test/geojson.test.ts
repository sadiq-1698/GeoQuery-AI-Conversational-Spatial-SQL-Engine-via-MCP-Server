import assert from "node:assert/strict";
import { test } from "node:test";

import { createIsochroneQueryHandler } from "../src/tools/isochroneQuery.js";
import { createSpatialBufferHandler } from "../src/tools/spatialBuffer.js";
import { createMockDb } from "./mockDb.js";

function parseFeatureCollection(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0]!.text!);
}

test("spatial_buffer maps rows into a GeoJSON FeatureCollection", async () => {
  const db = createMockDb(() => [
    {
      id: "123",
      name: "Test Hospital",
      category: "hospital",
      amenity: "hospital",
      geometry: { type: "Point", coordinates: [-122.33, 47.6] },
      distance_m: 150.5,
    },
  ]);
  const handler = createSpatialBufferHandler(db);

  const result = await handler({
    center_lon: -122.33,
    center_lat: 47.6,
    radius_meters: 2000,
    region: "seattle-wa",
    limit: 100,
  });

  const parsed = parseFeatureCollection(result);
  assert.equal(parsed.type, "FeatureCollection");
  assert.equal(parsed.features.length, 1);
  assert.deepEqual(parsed.features[0].geometry, {
    type: "Point",
    coordinates: [-122.33, 47.6],
  });
  assert.equal(parsed.features[0].properties.name, "Test Hospital");
  assert.equal(parsed.features[0].properties.distance_m, 150.5);
});

test("spatial_buffer passes all inputs through to query params in order", async () => {
  const db = createMockDb(() => []);
  const handler = createSpatialBufferHandler(db);

  await handler({
    center_lon: 1,
    center_lat: 2,
    radius_meters: 300,
    category: "school",
    region: "x",
    limit: 10,
  });

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0]!.params, [1, 2, 300, "school", "x", 10]);
});

test("spatial_buffer passes null (not undefined) for an omitted category", async () => {
  const db = createMockDb(() => []);
  const handler = createSpatialBufferHandler(db);

  await handler({ center_lon: 0, center_lat: 0, radius_meters: 100, region: "x", limit: 10 });

  // The SQL is `category = $4` behind an `($4::text IS NULL OR ...)` guard —
  // it must receive an explicit null, not `undefined` (pg would send that
  // as NULL too, but being explicit here documents the contract).
  assert.equal(db.calls[0]!.params![3], null);
});

test("spatial_buffer returns an empty FeatureCollection when no rows match", async () => {
  const db = createMockDb(() => []);
  const handler = createSpatialBufferHandler(db);

  const result = await handler({ center_lon: 0, center_lat: 0, radius_meters: 100, region: "x", limit: 10 });

  assert.deepEqual(parseFeatureCollection(result), { type: "FeatureCollection", features: [] });
});

test("isochrone_query computes radius from minutes * walking speed", async () => {
  const db = createMockDb((sql) => {
    if (sql.includes("osm_pois") || sql.includes("census_block_groups")) return [];
    return [{ geometry: { type: "Polygon", coordinates: [[[0, 0]]] } }];
  });
  const handler = createIsochroneQueryHandler(db);

  const result = await handler({ center_lon: 0, center_lat: 0, minutes: 10, mode: "walk", region: "x" });

  const isochrone = parseFeatureCollection(result).features[0];
  assert.equal(isochrone.properties.kind, "isochrone");
  assert.equal(isochrone.properties.radius_meters, 10 * 60 * 1.25);
  assert.match(isochrone.properties.approximation, /not routed travel time/i);
});

test("isochrone_query computes a different radius for driving", async () => {
  const db = createMockDb((sql) => {
    if (sql.includes("osm_pois") || sql.includes("census_block_groups")) return [];
    return [{ geometry: { type: "Polygon", coordinates: [[[0, 0]]] } }];
  });
  const handler = createIsochroneQueryHandler(db);

  const result = await handler({ center_lon: 0, center_lat: 0, minutes: 10, mode: "drive", region: "x" });

  assert.equal(parseFeatureCollection(result).features[0].properties.radius_meters, 10 * 60 * 8.33);
});

test("isochrone_query assembles isochrone + POI + block-group features into one collection", async () => {
  const db = createMockDb((sql) => {
    if (sql.includes("osm_pois")) {
      return [
        {
          id: "1",
          name: "Corner Cafe",
          category: "cafe",
          amenity: "cafe",
          geometry: { type: "Point", coordinates: [0.001, 0.001] },
        },
      ];
    }
    if (sql.includes("census_block_groups")) {
      return [
        {
          geoid: "530330001001",
          population: 1000,
          median_income: 50000,
          housing_units: 400,
          geometry: { type: "Point", coordinates: [0.002, 0.002] },
        },
      ];
    }
    return [{ geometry: { type: "Polygon", coordinates: [[[0, 0]]] } }];
  });
  const handler = createIsochroneQueryHandler(db);

  const result = await handler({ center_lon: 0, center_lat: 0, minutes: 5, mode: "walk", region: "x" });
  const { features } = parseFeatureCollection(result);

  assert.equal(features.length, 3);
  assert.equal(features.filter((f: { properties: { kind: string } }) => f.properties.kind === "isochrone").length, 1);

  const poi = features.find((f: { properties: { kind: string } }) => f.properties.kind === "poi");
  assert.equal(poi.properties.name, "Corner Cafe");

  const blockGroup = features.find(
    (f: { properties: { kind: string } }) => f.properties.kind === "block_group_centroid",
  );
  assert.equal(blockGroup.properties.geoid, "530330001001");
  assert.equal(blockGroup.properties.population, 1000);
});

test("isochrone_query queries all three data sources scoped to the same region", async () => {
  const db = createMockDb((sql) => {
    if (sql.includes("osm_pois") || sql.includes("census_block_groups")) return [];
    return [{ geometry: { type: "Polygon", coordinates: [[[0, 0]]] } }];
  });
  const handler = createIsochroneQueryHandler(db);

  await handler({ center_lon: 0, center_lat: 0, minutes: 5, mode: "walk", region: "seattle-wa" });

  assert.equal(db.calls.length, 3);
  // Buffer-only query takes 3 params (no region); the other two take 4.
  const regionScoped = db.calls.filter((c) => c.params?.length === 4);
  assert.equal(regionScoped.length, 2);
  for (const call of regionScoped) {
    assert.equal(call.params![3], "seattle-wa");
  }
});
