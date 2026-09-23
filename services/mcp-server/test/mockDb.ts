import type { QueryResult, QueryResultRow } from "pg";

import type { Database } from "../src/db.js";

export type MockQueryHandler = (
  sql: string,
  params: unknown[] | undefined,
) => QueryResultRow[] | Promise<QueryResultRow[]>;

export interface MockDatabase extends Database {
  /** Every call made through this mock, in order — for asserting what a handler actually sent. */
  calls: Array<{ sql: string; params: unknown[] | undefined }>;
}

/**
 * A Database implementation backed by a plain function instead of a real
 * Postgres connection, so tool handler logic (query construction, GeoJSON
 * shaping) can be tested with fixture rows and no live database. This is
 * exactly what db.ts's `Database` interface exists to make possible.
 */
export function createMockDb(handler: MockQueryHandler): MockDatabase {
  const calls: MockDatabase["calls"] = [];

  return {
    calls,
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      calls.push({ sql, params });
      const rows = (await handler(sql, params)) as T[];
      return {
        rows,
        rowCount: rows.length,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  };
}
