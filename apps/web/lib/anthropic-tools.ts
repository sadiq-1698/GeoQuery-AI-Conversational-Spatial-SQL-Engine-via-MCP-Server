import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Maps the MCP server's listTools() output to Anthropic's `tools` API
 * parameter. Both are plain JSON Schema underneath — MCP's `inputSchema`
 * (itself derived from Zod shapes, see services/mcp-server's
 * toolSchemas.ts) and Anthropic's `input_schema` share the same
 * {type: "object", properties, required} shape, so this is a field
 * rename, not a real format conversion.
 */
export async function listAnthropicTools(client: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}
