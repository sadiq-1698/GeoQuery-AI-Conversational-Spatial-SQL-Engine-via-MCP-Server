"use client";

import { useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { LayerToggleList } from "@/components/LayerToggleList";
import { MapView, type MapLayerData } from "@/components/MapView";
import styles from "./page.module.css";

// Split-pane layout: chat on the left, map on the right. `layers` and
// `hiddenSourceIds` are lifted here (not owned by ChatPanel or MapView)
// because they're the state both MapView and LayerToggleList need to
// share — everything else about the chat transcript stays local to
// ChatPanel.
export default function Home() {
  const [layers, setLayers] = useState<MapLayerData[]>([]);
  const [hiddenSourceIds, setHiddenSourceIds] = useState<Set<string>>(new Set());

  function handleLayer(layer: MapLayerData) {
    setLayers((prev) => [...prev, layer]);
  }

  function handleToggleLayer(sourceId: string) {
    setHiddenSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  }

  const visibleLayers = layers.filter((layer) => !hiddenSourceIds.has(layer.sourceId));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>GeoQuery AI</h1>
      </header>
      <main className={styles.main}>
        <section className={styles.chatPane} aria-label="Chat">
          <ChatPanel onLayer={handleLayer} />
        </section>
        <section className={styles.mapPane} aria-label="Map">
          <MapView layers={visibleLayers} />
          <LayerToggleList layers={layers} hiddenSourceIds={hiddenSourceIds} onToggle={handleToggleLayer} />
        </section>
      </main>
    </div>
  );
}
