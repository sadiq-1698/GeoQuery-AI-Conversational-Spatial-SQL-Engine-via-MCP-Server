import type { MapLayerData } from "./MapView";
import styles from "./LayerToggleList.module.css";

export interface LayerToggleListProps {
  /** Every layer produced so far this conversation, not just the visible ones. */
  layers: MapLayerData[];
  hiddenSourceIds: ReadonlySet<string>;
  onToggle: (sourceId: string) => void;
}

// Only spatial_buffer and isochrone_query ever actually produce a
// FeatureCollection (see agent-loop.ts's tryParseFeatureCollection) —
// postgis_raw_sql's {rows, row_count, truncated} output never does — but
// the fallback keeps this correct rather than silently blank if that ever
// changes.
const TOOL_LABELS: Record<string, string> = {
  spatial_buffer: "Nearby search",
  isochrone_query: "Reachable area",
};

function friendlyLayerLabel(sourceId: string): string {
  const lastDash = sourceId.lastIndexOf("-");
  if (lastDash === -1) return sourceId;
  const toolName = sourceId.slice(0, lastDash);
  const turn = sourceId.slice(lastDash + 1);
  const base = TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
  return `${base} #${turn}`;
}

/**
 * A floating overlay (positioned over the map, top-left — MapLibre's own
 * nav control sits top-right) listing every result produced so far, with a
 * checkbox to show/hide each one. Visibility itself is decided by the
 * parent (page.tsx filters `layers` before handing them to MapView) — this
 * component only renders the list and reports clicks, matching the same
 * "dumb" presentational role MessageBubble plays for chat.
 */
export function LayerToggleList({ layers, hiddenSourceIds, onToggle }: LayerToggleListProps) {
  if (layers.length === 0) return null;

  return (
    <div className={styles.panel}>
      <p className={styles.heading}>Results</p>
      <ul className={styles.list}>
        {layers.map((layer) => (
          <li key={layer.sourceId}>
            <label className={styles.label}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={!hiddenSourceIds.has(layer.sourceId)}
                onChange={() => onToggle(layer.sourceId)}
              />
              {friendlyLayerLabel(layer.sourceId)}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
