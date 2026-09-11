import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * The minimal shape every tool handler depends on. Real code gets `pool`
 * (below); tests substitute a mock implementing this same interface with
 * fixture rows, so tool logic can be tested without a live Postgres.
 */
export interface Database {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

function createPool(): Database {
  const connectionString = process.env.MCP_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "MCP_DATABASE_URL environment variable is required (see .env.example). " +
        "The MCP server must connect using the read-only geoquery_ro role — " +
        "never DATABASE_URL, which holds admin/write credentials.",
    );
  }
  return new Pool({ connectionString });
}

// Fails fast at import time if misconfigured, rather than surfacing a
// confusing error the first time a tool tries to run a query.
export const db: Database = createPool();
