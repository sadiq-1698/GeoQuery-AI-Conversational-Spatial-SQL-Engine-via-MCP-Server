"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import type { FeatureCollection } from "geojson";

import type { MapLayerData } from "./MapView";
import { MessageBubble } from "./MessageBubble";
import styles from "./ChatPanel.module.css";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface ChatPanelProps {
  onLayer: (layer: MapLayerData) => void;
}

type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "geojson"; toolName: string; geojson: FeatureCollection }
  | { type: "done"; messages: Anthropic.MessageParam[] }
  | { type: "error"; message: string };

/**
 * Derives display bubbles from the full Anthropic message history. The
 * history also contains "user"-role tool_result messages (the agent loop's
 * mechanical plumbing, not anything the human typed) and assistant-role
 * tool_use blocks (whose effect shows up on the map, not as text) — neither
 * belongs in the chat log, so both are filtered out here rather than ever
 * being stored as display state.
 */
function deriveDisplayMessages(history: Anthropic.MessageParam[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];
  history.forEach((message, index) => {
    // MessageParam.role's type allows "system", but neither our own code
    // nor agent-loop.ts ever constructs one (the system prompt travels via
    // messages.stream()'s separate `system` param) — narrowed explicitly
    // rather than cast, so a real future "system" entry fails loudly here
    // instead of silently mis-rendering.
    if (message.role !== "user" && message.role !== "assistant") return;

    if (typeof message.content === "string") {
      if (message.content.trim()) {
        result.push({ id: `msg-${index}`, role: message.role, text: message.content });
      }
      return;
    }
    if (message.role === "user") return; // tool_result blocks — not human-authored

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text.trim()) {
      result.push({ id: `msg-${index}`, role: "assistant", text });
    }
  });
  return result;
}

export function ChatPanel({ onLayer }: ChatPanelProps) {
  const [history, setHistory] = useState<Anthropic.MessageParam[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const layerCounterRef = useRef(0);

  const displayMessages = deriveDisplayMessages(history);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isStreaming) return;

    const nextHistory: Anthropic.MessageParam[] = [...history, { role: "user", content: text }];
    setHistory(nextHistory);
    setDraft("");
    setIsStreaming(true);
    setStreamingText("");
    setErrorMessage(null);

    try {
      await streamChat(nextHistory, {
        onText: (delta) => setStreamingText((prev) => prev + delta),
        onGeojson: (toolName, geojson) => {
          layerCounterRef.current += 1;
          onLayer({ sourceId: `${toolName}-${layerCounterRef.current}`, data: geojson });
        },
        onDone: (messages) => {
          setHistory(messages);
          setStreamingText("");
        },
        onError: (message) => setErrorMessage(message),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStreaming(false);
    }
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
        {displayMessages.length === 0 && !isStreaming && (
          <p className={styles.emptyState}>
            Ask about nearby places, or what&apos;s reachable within N minutes of a location.
          </p>
        )}
        {displayMessages.map((message) => (
          <MessageBubble key={message.id} role={message.role} text={message.text} />
        ))}
        {isStreaming && <MessageBubble role="assistant" text={streamingText || "…"} />}
      </div>
      {errorMessage && <p className={styles.errorBanner}>{errorMessage}</p>}
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
        <button type="submit" className={styles.sendButton} disabled={!draft.trim() || isStreaming}>
          Send
        </button>
      </form>
    </div>
  );
}

interface StreamCallbacks {
  onText: (delta: string) => void;
  onGeojson: (toolName: string, geojson: FeatureCollection) => void;
  onDone: (messages: Anthropic.MessageParam[]) => void;
  onError: (message: string) => void;
}

async function streamChat(messages: Anthropic.MessageParam[], callbacks: StreamCallbacks): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(
      (body && typeof body === "object" && "error" in body && String(body.error)) ||
        `Request failed with status ${response.status}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function handleLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ChatStreamEvent;
    switch (event.type) {
      case "text":
        callbacks.onText(event.delta);
        break;
      case "geojson":
        callbacks.onGeojson(event.toolName, event.geojson);
        break;
      case "done":
        callbacks.onDone(event.messages);
        break;
      case "error":
        callbacks.onError(event.message);
        break;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // last entry may be a partial line — held over
    for (const line of lines) handleLine(line);
  }
  if (buffer.trim()) handleLine(buffer);
}
