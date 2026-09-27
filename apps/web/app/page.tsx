import { MapView } from "@/components/MapView";
import styles from "./page.module.css";

// Split-pane skeleton: chat on the left, map on the right. ChatPanel
// (Session 11) slots into chatPane the same way MapView does here, without
// changing this layout.
export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>GeoQuery AI</h1>
      </header>
      <main className={styles.main}>
        <section className={styles.chatPane} aria-label="Chat">
          <div className={styles.placeholder}>Chat panel — coming in Session 11</div>
        </section>
        <section className={styles.mapPane} aria-label="Map">
          <MapView />
        </section>
      </main>
    </div>
  );
}
