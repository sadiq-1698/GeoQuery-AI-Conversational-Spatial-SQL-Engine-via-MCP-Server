import styles from "./page.module.css";

// Split-pane skeleton: chat on the left, map on the right. Both panes are
// placeholders for now — ChatPanel (Session 11) and MapView (Session 10)
// slot in here without changing this layout.
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
          <div className={styles.placeholder}>Map — coming in Session 10</div>
        </section>
      </main>
    </div>
  );
}
