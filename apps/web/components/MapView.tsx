"use client";

import { useEffect, useRef, useState } from "react";
// maplibre-gl v6 has no default export — confirmed by inspecting its actual
// runtime bundle (dist/maplibre-gl.mjs), not assumed from memory: every
// class is a plain named export, including a MapLibreMap alias for Map
// (avoiding a collision with the built-in JS Map).
import { MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

import { computeBounds, removeGeoJsonLayer, upsertGeoJsonLayer } from "@/lib/mapLayers";
import styles from "./MapView.module.css";

// Free, no-API-key vector basemap (OpenFreeMap — see https://openfreemap.org,
// intended for real traffic, unlike MapLibre's own demotiles.maplibre.org
// which is explicitly testing-only). Attribution is supplied by the style
// itself and shown via MapLibre's default AttributionControl.
const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// maplibre-gl normally loads its tile-parsing worker via a bundler-rewritten
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`; Turbopack doesn't
// currently rewrite that reference for a node_modules dependency, so the
// worker 404s and every map logs "Worker failed to load" (confirmed via a
// real browser, not just typechecking — see scripts/copy-maplibre-worker.mjs
// for the full explanation). Pointing at a plain static copy sidesteps
// bundler URL-rewriting entirely. Set once at module load, before any Map
// is constructed.
setWorkerUrl("/maplibre-gl/maplibre-gl-worker.mjs");

export interface MapLayerData {
  sourceId: string;
  data: FeatureCollection;
}

export interface MapViewProps {
  /** GeoJSON layers to render, keyed by sourceId. Diffed against what's
   * currently on the map each time this prop changes: entries no longer
   * present are removed, the rest are added or setData()-updated. */
  layers?: MapLayerData[];
  className?: string;
}

export function MapView({ layers = [], className }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const renderedSourceIdsRef = useRef<Set<string>>(new Set());
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center: [0, 20],
      zoom: 1.5,
    });
    map.addControl(new NavigationControl(), "top-right");
    map.once("load", () => setIsStyleLoaded(true));
    mapRef.current = map;

    // MapLibre sizes its canvas from the container's dimensions at
    // construction time and does not re-check them on its own. In this
    // split-pane CSS Grid layout, the container isn't necessarily at its
    // final size on that first render, which left the canvas visibly
    // smaller than its pane (confirmed via a real browser screenshot, not
    // just code review) until the browser window itself was resized. A
    // ResizeObserver keeps it in sync with whatever size the grid actually
    // settles on, and with any later layout changes (e.g. the chat pane
    // resizing).
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      renderedSourceIdsRef.current = new Set();
      setIsStyleLoaded(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoaded) return;

    const nextSourceIds = new Set(layers.map((layer) => layer.sourceId));
    for (const existingSourceId of renderedSourceIdsRef.current) {
      if (!nextSourceIds.has(existingSourceId)) {
        removeGeoJsonLayer(map, existingSourceId);
      }
    }
    for (const { sourceId, data } of layers) {
      upsertGeoJsonLayer(map, sourceId, data);
      // Fly to genuinely new layers (not ones already rendered, which would
      // otherwise re-fit the camera on every unrelated re-render) so a
      // reply's map data is actually visible without the user needing to
      // manually pan/zoom to find it — otherwise a chat message like "here
      // are some hospitals" would silently update a part of the map no one
      // is looking at.
      if (!renderedSourceIdsRef.current.has(sourceId)) {
        const bounds = computeBounds(data);
        if (bounds) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 600 });
        }
      }
    }
    renderedSourceIdsRef.current = nextSourceIds;
    // `layers` is compared by reference each render, not deep-equal — fine
    // for now since each mock/real turn produces a new sourceId rather than
    // mutating an existing one in place; revisit if that assumption changes.
  }, [layers, isStyleLoaded]);

  return (
    <div className={`${styles.wrapper} ${className ?? ""}`}>
      <div ref={containerRef} className={styles.map} />
      {!isStyleLoaded && <div className={styles.loadingOverlay}>Loading map…</div>}
    </div>
  );
}
