import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { FeatureCollection } from "geojson";

import { listAnthropicTools } from "./anthropic-tools";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 4096;
// A model that keeps retrying a failing tool (or chains tool calls
// indefinitely) would otherwise run the while(true) loop below forever —
// no cost/latency circuit breaker existed before this. 10 rounds is well
// above any legitimate multi-tool question this app's three tools need to
// answer.
const MAX_TOOL_ITERATIONS = 10;

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
 * Thrown instead of a plain Error whenever the loop fails after at least one
 * full round (model turn, or model turn + tool calls) has already completed
 * — carries that history so the caller can still sync it to the client
 * before surfacing the failure. Without this, a failure on round 2+ (e.g.
 * the model calls a tool successfully, then a later round errors) used to
 * silently drop that earlier round's tool_use/tool_result pair: the client
 * never advances its `history` state past the user's message (that only
 * happens on a successful return, via the `done` event), even though the
 * tool's side effect (a map layer) had already rendered client-side from
 * its own separate event. The model could then "forget" it had already
 * called that tool on the next turn.
 */
export class AgentLoopError extends Error {
  constructor(
    message: string,
    public readonly partialMessages: Anthropic.MessageParam[],
  ) {
    super(message);
    this.name = "AgentLoopError";
  }
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

  for (let iteration = 0; ; iteration += 1) {
    if (iteration >= MAX_TOOL_ITERATIONS) {
      throw new AgentLoopError(
        `Gave up after ${MAX_TOOL_ITERATIONS} tool-call rounds without a final answer.`,
        currentMessages,
      );
    }

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

    let response: Anthropic.Message;
    try {
      response = await stream.finalMessage();
    } catch (error) {
      // Any failure here (auth error, network failure, rate limit) still
      // needs to preserve whatever rounds already succeeded before this one
      // — currentMessages at this point already has them. Known residual
      // gap: if this round's own stream had already emitted some onText
      // deltas before failing, that dangling text isn't part of
      // currentMessages (we never got a complete response to append) and
      // ChatPanel's ref-based fallback can't cleanly separate it from
      // earlier rounds' text once a `done` sync has cleared the ref — a
      // narrower version of the original bug, not reintroduced for the
      // common cases (round 1 failures, and the two explicit throws below).
      const message = error instanceof Error ? error.message : String(error);
      throw new AgentLoopError(message, currentMessages);
    }
    currentMessages = [...currentMessages, { role: "assistant", content: response.content }];

    // max_tokens is an OUTPUT cap per turn, not a conversation-length limit
    // — hitting it mid-reply used to be treated like any other non-tool_use
    // stop and returned silently, so the user would just see a reply that
    // stops mid-sentence with no indication anything was cut off.
    if (response.stop_reason === "max_tokens") {
      throw new AgentLoopError(
        "The response was cut off after reaching the model's output limit for this turn.",
        currentMessages,
      );
    }

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
