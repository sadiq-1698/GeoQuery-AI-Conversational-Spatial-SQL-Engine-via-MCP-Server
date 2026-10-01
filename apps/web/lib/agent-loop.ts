import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { FeatureCollection } from "geojson";

import { listAnthropicTools } from "./anthropic-tools";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 4096;

function buildSystemPrompt(defaultRegion?: string): string {
  return [
    "You are GeoQuery AI, a spatial-analysis assistant with access to a live " +
      "PostGIS database through three tools: spatial_buffer, isochrone_query, " +
      "and postgis_raw_sql.",
    "",
    "Tool-use discipline:",
    "- Prefer spatial_buffer or isochrone_query whenever the question fits " +
      "either of them. Only reach for postgis_raw_sql when the structured " +
      "tools genuinely can't express the question (e.g. an aggregate or " +
      "ranking question across many rows).",
    "- Every structured tool call requires a `region` value. " +
      (defaultRegion
        ? `If the user doesn't name a region, assume "${defaultRegion}" and say so.`
        : "If the user doesn't name a region and none is configured, ask which city/region to search rather than guessing."),
    "- isochrone_query is a straight-line distance approximation, not routed " +
      "travel time. Always say so explicitly whenever you use it or " +
      "reference its results — never present it as an exact reachable area.",
    "",
    "Output contract:",
    "- After a tool call returns, write a short natural-language summary of " +
      "the result for the user.",
    "- Do not describe or reconstruct coordinates/GeoJSON in your prose — " +
      "the map renders the last tool result automatically. Your job is to " +
      "summarize it in words, not repeat the raw data.",
  ].join("\n");
}

export interface AgentLoopEvents {
  /** A text token as it streams in from the model. */
  onText?: (delta: string) => void;
  /** Fired when the model decides to call a tool, before it runs. */
  onToolUse?: (toolName: string, input: unknown) => void;
  /** Fired once a tool call resolves (success or failure). */
  onToolResult?: (toolName: string, payload: ToolResultPayload) => void;
}

export interface ToolResultPayload {
  text: string;
  geojson?: FeatureCollection;
  isError: boolean;
}

export interface AgentLoopOptions {
  defaultRegion?: string;
  events?: AgentLoopEvents;
}

/**
 * Runs the Claude tool-use loop to completion: calls the model, executes any
 * tool_use blocks against the MCP server, feeds tool_result blocks back, and
 * repeats until the model stops for a reason other than "tool_use". Returns
 * the full updated message history (input + every assistant/tool turn), so
 * the caller can persist or continue the conversation.
 *
 * Pure aside from its two injected dependencies (anthropic, mcpClient) —
 * both can be mocked, matching the same dependency-injection pattern
 * services/mcp-server's tool handlers use for `db`.
 */
export async function runAgentLoop(
  anthropic: Anthropic,
  mcpClient: Client,
  messages: Anthropic.MessageParam[],
  options: AgentLoopOptions = {},
): Promise<Anthropic.MessageParam[]> {
  const tools = await listAnthropicTools(mcpClient);
  const system = buildSystemPrompt(options.defaultRegion);
  let currentMessages = messages;

  while (true) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      messages: currentMessages,
    });

    if (options.events?.onText) {
      stream.on("text", options.events.onText);
    }

    const response = await stream.finalMessage();
    currentMessages = [...currentMessages, { role: "assistant", content: response.content }];

    if (response.stop_reason !== "tool_use") {
      return currentMessages;
    }

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      options.events?.onToolUse?.(block.name, block.input);
      const payload = await callMcpTool(mcpClient, block.name, block.input);
      options.events?.onToolResult?.(block.name, payload);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: payload.text,
        is_error: payload.isError,
      });
    }

    currentMessages = [...currentMessages, { role: "user", content: toolResults }];
  }
}

// The MCP SDK's own Client["callTool"] return type is generated from a deep
// Zod v4 schema chain that TypeScript fails to resolve through this call
// pattern — it comes back as `unknown` even with the resultSchema argument
// passed explicitly (confirmed by isolating the call in a standalone file;
// not a mistake in how it's called here). Since our own MCP server
// (services/mcp-server) only ever returns a single {type: "text", text}
// content block — never image/audio/resource — this narrower local type is
// actually a better fit for our use than the SDK's full union would be
// anyway, not just a workaround.
interface McpTextToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callMcpTool(mcpClient: Client, name: string, input: unknown): Promise<ToolResultPayload> {
  try {
    // Claude always produces an object matching the tool's input_schema
    // (type: "object"), so this cast reflects a real runtime guarantee
    // rather than an unchecked assumption.
    const result = (await mcpClient.callTool({
      name,
      arguments: input as Record<string, unknown>,
    })) as McpTextToolResult;
    const textBlock = result.content.find((block) => block.type === "text");
    const text = textBlock?.text ?? "";
    return { text, geojson: tryParseFeatureCollection(text), isError: Boolean(result.isError) };
  } catch (error) {
    // A thrown error (e.g. the MCP transport itself failing) rather than a
    // tool-level isError result — still surfaced to the model as a failed
    // tool_result so it can recover (retry differently, apologize, etc.)
    // instead of crashing the whole conversation turn.
    const message = error instanceof Error ? error.message : String(error);
    return { text: message, isError: true };
  }
}

// Not every tool result is map-renderable: postgis_raw_sql returns
// {rows, row_count, truncated}, not a FeatureCollection. Only
// spatial_buffer/isochrone_query's output should ever populate the map.
function tryParseFeatureCollection(text: string): FeatureCollection | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      (parsed as { type: unknown }).type === "FeatureCollection"
    ) {
      return parsed as FeatureCollection;
    }
  } catch {
    // Not JSON at all — also fine, just means no map layer this turn.
  }
  return undefined;
}
