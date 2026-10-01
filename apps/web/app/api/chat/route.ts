import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { runAgentLoop } from "@/lib/agent-loop";
import { getMcpClient } from "@/lib/mcp-client";

// mcp-client.ts spawns services/mcp-server as a child process via
// node:child_process — this cannot run on the Edge runtime.
export const runtime = "nodejs";

// Constructing this doesn't make a network call or throw synchronously if
// ANTHROPIC_API_KEY is missing — the SDK resolves/validates credentials
// once, lazily, and only surfaces a failure when a request is actually
// made, which our try/catch below turns into a normal `error` stream event
// rather than crashing the route module at import time.
const anthropic = new Anthropic();

// Loose on purpose: this is an internal API only ever called by our own
// ChatPanel (not a public endpoint), and the client resends whatever
// Anthropic.MessageParam[] it was last given verbatim (see the `done`
// event below) — tool_use/tool_result content blocks included. Precisely
// re-validating Anthropic's full content-block union here would duplicate
// validation the Anthropic API already does on the actual request.
const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.union([z.string(), z.array(z.unknown())]),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Structurally validated above (role, string-or-array content); trusting
  // the detailed content-block shape to the Anthropic API itself, as
  // explained on chatRequestSchema.
  const messages = parsed.data.messages as Anthropic.MessageParam[];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>): void {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }

      try {
        const mcpClient = await getMcpClient();
        const finalMessages = await runAgentLoop(anthropic, mcpClient, messages, {
          defaultRegion: process.env.DEFAULT_REGION,
          events: {
            onText: (delta) => send({ type: "text", delta }),
            onToolResult: (toolName, payload) => {
              // Not every tool result is map-renderable (postgis_raw_sql's
              // output isn't a FeatureCollection) — only forward a geojson
              // event when there's actually a layer to show.
              if (payload.geojson) {
                send({ type: "geojson", toolName, geojson: payload.geojson });
              }
            },
          },
        });
        // Carries the full updated history (including tool_use/tool_result
        // blocks the client never otherwise sees) so the client can resend
        // it verbatim next turn — this route is stateless; the client owns
        // conversation state as an opaque Anthropic.MessageParam[] blob.
        send({ type: "done", messages: finalMessages });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
