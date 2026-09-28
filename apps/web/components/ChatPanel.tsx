"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

import { mockAssistantReply } from "@/lib/mockAssistant";
import type { MapLayerData } from "./MapView";
import { MessageBubble } from "./MessageBubble";
import styles from "./ChatPanel.module.css";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface ChatPanelProps {
  onLayer: (layer: MapLayerData) => void;
}

// Purely cosmetic — long enough that a reply doesn't pop in so instantly it
// looks broken, short enough not to feel like a real wait. Not standing in
// for anything (the real agent loop streams incrementally; see Session 14).
const MOCK_REPLY_DELAY_MS = 500;

export function ChatPanel({ onLayer }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isAssistantTyping) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setIsAssistantTyping(true);

    setTimeout(() => {
      const reply = mockAssistantReply(text, userMessage.id);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: reply.text }]);
      if (reply.layer) {
        onLayer(reply.layer);
      }
      setIsAssistantTyping(false);
    }, MOCK_REPLY_DELAY_MS);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.messages} role="log" aria-live="polite">
        {messages.length === 0 && (
          <p className={styles.emptyState}>
            Ask about hospitals near a location, or what&apos;s reachable within N minutes.
          </p>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} role={message.role} text={message.text} />
        ))}
        {isAssistantTyping && <MessageBubble role="assistant" text="…" />}
      </div>
      <form className={styles.composer} onSubmit={handleSubmit}>
        <textarea
          className={styles.textarea}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question..."
          rows={2}
          aria-label="Chat message"
        />
        <button type="submit" className={styles.sendButton} disabled={!draft.trim() || isAssistantTyping}>
          Send
        </button>
      </form>
    </div>
  );
}
