import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required (see .env.example)`);
  }
  return value;
}

async function connectClient(): Promise<Client> {
  const command = process.env.MCP_SERVER_CMD ?? "node";
  const serverEntrypoint = requireEnv("MCP_SERVER_ARGS");
  const mcpDatabaseUrl = requireEnv("MCP_DATABASE_URL");

  const transport = new StdioClientTransport({
    command,
    args: [serverEntrypoint],
    env: {
      // getDefaultEnvironment() is the SDK's own curated, safe subset of
      // the parent environment (PATH, HOME, etc. — whatever a spawned
      // `node` process needs to run), not the whole of process.env. That
      // matters here specifically: this process also holds ANTHROPIC_API_KEY
      // and the admin DATABASE_URL, neither of which the MCP server has any
      // legitimate use for and both of which it should be structurally
      // unable to read — consistent with the read-only geoquery_ro role it
      // already connects with (services/mcp-server/src/db.ts). Forwarding
      // the full environment here would quietly undo that boundary.
      ...getDefaultEnvironment(),
      MCP_DATABASE_URL: mcpDatabaseUrl,
    },
  });

  const client = new Client({ name: "geoquery-web", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

declare global {
  var __mcpClientPromise: Promise<Client> | undefined;
}

/**
 * Returns the shared MCP client, spawning the server child process and
 * connecting to it on first call only. Cached on globalThis rather than a
 * plain module-level variable because Next.js dev-mode module reloading
 * (Fast Refresh) re-executes a route module's top-level code without a
 * full process restart, which would otherwise spawn a duplicate server
 * process on every edit — the same pattern commonly used for Prisma
 * clients in Next.js dev.
 */
export function getMcpClient(): Promise<Client> {
  globalThis.__mcpClientPromise ??= connectClient();
  return globalThis.__mcpClientPromise;
}
