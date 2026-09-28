import type { FeatureCollection } from "geojson";

import type { MapLayerData } from "@/components/MapView";

export interface MockAssistantReply {
  text: string;
  layer?: MapLayerData;
}

// Stands in for the real Claude agent loop (Sessions 12-14) so ChatPanel's
// UI and its wiring into MapView's `layers` prop can be built and checked
// by hand before any backend exists. Nothing here does real spatial
// reasoning — it's keyword matching over canned sample data, replaced
// wholesale once app/api/chat/route.ts exists. `turnId` only needs to be
// unique per call, so each mock reply gets its own map source rather than
// overwriting the previous one.
export function mockAssistantReply(userText: string, turnId: string): MockAssistantReply {
  const text = userText.toLowerCase();

  if (text.includes("hospital")) {
    return {
      text: "Here are some sample hospitals near downtown Seattle (mock data — no live database connected yet).",
      layer: { sourceId: `mock-${turnId}`, data: SAMPLE_HOSPITALS },
    };
  }

  if (text.includes("minute") || text.includes("isochrone") || text.includes("reach")) {
    return {
      text: "Here's a sample 10-minute walking area (mock data — a plain rectangle standing in for the real straight-line approximation isochrone_query will return once it's wired up).",
      layer: { sourceId: `mock-${turnId}`, data: SAMPLE_ISOCHRONE },
    };
  }

  return {
    text: 'There\'s no live database connected yet, so I can\'t answer that for real. Try asking about "hospitals" or something "within 10 minutes" to see a sample map response.',
  };
}

const SAMPLE_HOSPITALS: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.335, 47.608] },
      properties: { name: "Harborview Medical Center (sample)", category: "hospital", distance_m: 450 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.32, 47.612] },
      properties: { name: "Swedish First Hill (sample)", category: "hospital", distance_m: 900 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.341, 47.615] },
      properties: { name: "Virginia Mason (sample)", category: "hospital", distance_m: 1200 },
    },
  ],
};

const SAMPLE_ISOCHRONE: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.345, 47.605],
            [-122.315, 47.605],
            [-122.315, 47.62],
            [-122.345, 47.62],
            [-122.345, 47.605],
          ],
        ],
      },
      properties: {
        kind: "isochrone",
        minutes: 10,
        mode: "walk",
        approximation: "Sample data — not a real isochrone.",
      },
    },
  ],
};
