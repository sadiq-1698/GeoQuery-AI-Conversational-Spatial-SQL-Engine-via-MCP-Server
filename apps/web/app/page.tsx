"use client";

import { useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { MapView, type MapLayerData } from "@/components/MapView";
import styles from "./page.module.css";

// Split-pane layout: chat on the left, map on the right. `layers` is lifted
// here (not owned by ChatPanel) because it's the one piece of state MapView
// actually needs — everything else about the chat transcript stays local
// to ChatPanel.
export default function Home() {
  const [layers, setLayers] = useState<MapLayerData[]>([]);

  function handleLayer(layer: MapLayerData) {
    setLayers((prev) => [...prev, layer]);
  }

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
          <MapView layers={layers} />
        </section>
      </main>
    </div>
  );
}
