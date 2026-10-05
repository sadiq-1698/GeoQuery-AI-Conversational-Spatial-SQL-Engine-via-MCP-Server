// maplibre-gl v6 has no default export — every value below (previously
// reached via a `maplibregl.X` namespace object in older versions) is now a
// plain named export. See MapView.tsx's comment for how this was confirmed.
import { GeoJSONSource, LngLatBounds, Popup, type ExpressionSpecification, type MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

const POINT_LAYER_SUFFIX = "-point";
const FILL_LAYER_SUFFIX = "-fill";
const LINE_LAYER_SUFFIX = "-line";

// Matches the POI_CATEGORIES vocabulary in
// services/mcp-server/src/schemas/toolSchemas.ts. Falls back to gray for
// anything not in this list (isochrone/block-group features use other
// property shapes entirely and never carry a `category`).
const CATEGORY_COLOR_EXPRESSION: ExpressionSpecification = [
  "match",
  ["get", "category"],
  "hospital",
  "#e74c3c",
  "school",
  "#3498db",
  "restaurant",
  "#e67e22",
  "cafe",
  "#8e5b3f",
  "park",
  "#2ecc71",
  "transit_stop",
  "#9b59b6",
  "shop",
  "#f1c40f",
  /* default (unmatched, or "other") */ "#7f8c8d",
];

function layerIds(sourceId: string) {
  return {
    point: `${sourceId}${POINT_LAYER_SUFFIX}`,
    fill: `${sourceId}${FILL_LAYER_SUFFIX}`,
    line: `${sourceId}${LINE_LAYER_SUFFIX}`,
  };
}

/**
 * Adds or updates a GeoJSON source rendered as: colored circles for Point
 * features (by `category`), and a semi-transparent fill + outline for
 * Polygon features (isochrones, census block groups — no polygons are
 * currently returned as centroids only, but the layer exists for when they
 * are). A mixed FeatureCollection is filtered per-layer by geometry-type, so
 * one source can hold both.
 */
export function upsertGeoJsonLayer(
  map: MapLibreMap,
  sourceId: string,
  data: FeatureCollection,
): void {
  const existing = map.getSource(sourceId);
  if (existing instanceof GeoJSONSource) {
    void existing.setData(data);
    return;
  }

  map.addSource(sourceId, { type: "geojson", data });
  const ids = layerIds(sourceId);

  map.addLayer({
    id: ids.point,
    type: "circle",
    source: sourceId,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 6,
      "circle-color": CATEGORY_COLOR_EXPRESSION,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: ids.fill,
    type: "fill",
    source: sourceId,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": "#3388ff",
      "fill-opacity": 0.15,
    },
  });

  map.addLayer({
    id: ids.line,
    type: "line",
    source: sourceId,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": "#3388ff",
      "line-width": 2,
    },
  });

  attachPointPopup(map, ids.point);
  attachPolygonPopup(map, ids.fill);
}

/** Removes a source and every layer upsertGeoJsonLayer created for it. */
export function removeGeoJsonLayer(map: MapLibreMap, sourceId: string): void {
  const ids = layerIds(sourceId);
  for (const layerId of Object.values(ids)) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

/**
 * Bounding box covering every coordinate in a FeatureCollection, regardless
 * of geometry type — used to fly/fit the map to newly-added data so it's
 * actually visible without the user needing to manually pan/zoom to find
 * it. Returns null for an empty collection (nothing to fit to).
 */
export function computeBounds(data: FeatureCollection): LngLatBounds | null {
  const bounds = new LngLatBounds();

  function extend(coords: unknown): void {
    if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
      bounds.extend([coords[0], coords[1]]);
    } else if (Array.isArray(coords)) {
      for (const nested of coords) extend(nested);
    }
  }

  for (const feature of data.features) {
    // GeometryCollection has no `.coordinates` — none of our tools produce
    // one, but the type is part of the Geometry union, so guard for it.
    if ("coordinates" in feature.geometry) {
      extend(feature.geometry.coordinates);
    }
  }

  return bounds.isEmpty() ? null : bounds;
}

function attachPointPopup(map: MapLibreMap, pointLayerId: string): void {
  map.on("mouseenter", pointLayerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", pointLayerId, () => {
    map.getCanvas().style.cursor = "";
  });

  map.on("click", pointLayerId, (event) => {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;

    const [lng, lat] = feature.geometry.coordinates;
    new Popup()
      .setLngLat([lng, lat])
      .setDOMContent(buildPopupContent(feature.properties ?? {}))
      .addTo(map);
  });
}

// Polygons (isochrones) don't have one natural anchor point the way a Point
// feature's own coordinates are — anchoring the popup at the actual click
// location (event.lngLat) is the standard pattern for area features.
function attachPolygonPopup(map: MapLibreMap, fillLayerId: string): void {
  map.on("mouseenter", fillLayerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", fillLayerId, () => {
    map.getCanvas().style.cursor = "";
  });

  map.on("click", fillLayerId, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;

    new Popup()
      .setLngLat(event.lngLat)
      .setDOMContent(buildPopupContent(feature.properties ?? {}))
      .addTo(map);
  });
}

// Internal discriminators our own tool handlers stamp onto properties
// (services/mcp-server/src/tools/isochroneQuery.ts) — useful for picking a
// heading and skipping from the generic property listing below, but not
// meaningful to show to a person verbatim ("Kind: isochrone").
const KIND_HEADINGS: Record<string, string> = {
  isochrone: "Reachable area",
  block_group_centroid: "Census block group",
};

// Keys that are either already used for the heading or are raw technical
// identifiers (OSM node ids, GEOIDs) not meaningful to a casual viewer.
const SKIP_KEYS = new Set(["name", "kind", "id", "geoid"]);

// Built with DOM APIs (createElement + textContent) rather than an HTML
// string passed to setHTML() — feature properties ultimately originate from
// OSM data / LLM-constructed queries, so treating them as trusted HTML would
// be an XSS vector. textContent never interprets its input as markup.
function buildPopupContent(properties: Record<string, unknown>): HTMLElement {
  const container = document.createElement("div");
  container.style.fontSize = "0.8rem";
  container.style.lineHeight = "1.4";
  container.style.maxWidth = "220px";

  const kind = typeof properties.kind === "string" ? properties.kind : undefined;
  const title =
    properties.name ??
    (kind && KIND_HEADINGS[kind]) ??
    properties.category ??
    properties.geoid ??
    "Feature";
  const heading = document.createElement("strong");
  heading.textContent = String(title);
  container.appendChild(heading);

  for (const [key, value] of Object.entries(properties)) {
    if (SKIP_KEYS.has(key) || value === null || value === undefined) continue;
    const row = document.createElement("div");
    row.textContent = `${formatLabel(key)}: ${formatValue(key, value)}`;
    container.appendChild(row);
  }

  return container;
}

function formatLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// Distances come back from the MCP tools in raw meters, and demographic
// figures as raw numbers — both read far more naturally formatted than
// printed verbatim (e.g. "distance_m: 1850" -> "Distance m: 1.9 km").
function formatValue(key: string, value: unknown): string {
  if (typeof value === "number" && (key === "distance_m" || key === "radius_meters")) {
    return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
  }
  if (typeof value === "number" && key === "median_income") {
    return `$${value.toLocaleString()}`;
  }
  if (typeof value === "number" && (key === "population" || key === "housing_units")) {
    return value.toLocaleString();
  }
  return String(value);
}
