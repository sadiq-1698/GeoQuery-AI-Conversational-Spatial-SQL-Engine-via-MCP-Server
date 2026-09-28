import styles from "./MessageBubble.module.css";

export interface MessageBubbleProps {
  role: "user" | "assistant";
  text: string;
}

export function MessageBubble({ role, text }: MessageBubbleProps) {
  return (
    <div className={`${styles.bubble} ${role === "user" ? styles.user : styles.assistant}`}>
      {text}
    </div>
  );
}
